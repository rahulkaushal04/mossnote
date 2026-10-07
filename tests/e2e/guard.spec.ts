import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, runServerOnce } from './fixtures';

/** Raw HTTP with full control over the Host header, over the real socket. */
function rawRequest(
  port: number,
  options: { method?: string; path?: string; headers: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path ?? '/api/health',
        headers: options.headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

test.describe('guard over a real socket', () => {
  test('refuses a foreign Host header (DNS rebinding)', async ({ server }) => {
    for (const host of [
      'evil.example',
      `evil.example:${server.port}`,
      'localhost',
      '10.0.0.5:4317',
    ]) {
      const res = await rawRequest(server.port, { headers: { host } });
      expect(res.status, host).toBe(403);
      expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'forbidden' } });
    }
    const ok = await rawRequest(server.port, { headers: { host: `127.0.0.1:${server.port}` } });
    expect(ok.status).toBe(200);
  });

  test('refuses a foreign Origin, and mutations without the client header', async ({ server }) => {
    const host = `127.0.0.1:${server.port}`;
    const origin = await rawRequest(server.port, {
      headers: { host, origin: 'https://evil.example' },
    });
    expect(origin.status).toBe(403);

    const body = JSON.stringify({ prefs: { readingSize: 'large' } });
    const noHeader = await rawRequest(server.port, {
      method: 'PATCH',
      path: '/api/settings',
      headers: { host, 'content-type': 'application/json', 'content-length': String(body.length) },
      body,
    });
    expect(noHeader.status).toBe(403);
    const form = await rawRequest(server.port, {
      method: 'PATCH',
      path: '/api/settings',
      headers: {
        host,
        'x-moss-client': 'web',
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(body.length),
      },
      body,
    });
    expect(form.status).toBe(403);
  });

  test('a cross-site page cannot read the API (no CORS headers, preflight refused)', async ({
    page,
    server,
  }) => {
    // Load a page from a different origin, then try to call the API from it.
    await page.route('https://other.example/', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>other</title>' }),
    );
    await page.goto('https://other.example/');
    const result = await page.evaluate(async (url) => {
      const outcome: Record<string, string> = {};
      try {
        await fetch(`${url}/api/settings`);
        outcome.get = 'resolved';
      } catch {
        outcome.get = 'blocked';
      }
      try {
        await fetch(`${url}/api/settings`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-moss-client': 'web' },
          body: '{}',
        });
        outcome.patch = 'resolved';
      } catch {
        outcome.patch = 'blocked';
      }
      return outcome;
    }, server.url);
    expect(result).toEqual({ get: 'blocked', patch: 'blocked' });
  });
});

test.describe('loopback only', () => {
  test('is not reachable on any non-loopback address of this machine', async ({ server }) => {
    const external = Object.values(os.networkInterfaces())
      .flat()
      .filter(
        (i): i is os.NetworkInterfaceInfo => Boolean(i) && i?.family === 'IPv4' && !i.internal,
      )
      .map((i) => i.address);
    test.skip(external.length === 0, 'No external IPv4 interface on this machine.');
    for (const address of external) {
      const outcome = await new Promise<string>((resolve) => {
        const socket = net.connect({ host: address, port: server.port, timeout: 2000 });
        socket.once('connect', () => {
          socket.destroy();
          resolve('connected');
        });
        socket.once('timeout', () => {
          socket.destroy();
          resolve('timeout');
        });
        socket.once('error', (error: NodeJS.ErrnoException) => {
          resolve(error.code ?? 'error');
        });
      });
      expect(outcome, address).not.toBe('connected');
    }
  });

  test('refuses to start on a non-loopback MOSS_HOST', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-host-'));
    const result = await runServerOnce({
      MOSS_DATA_DIR: dataDir,
      MOSS_HOST: '0.0.0.0',
      MOSS_PORT: '4399',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('loopback');
    expect(fs.existsSync(path.join(dataDir, 'journal.db'))).toBe(false);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

test.describe('startup failures', () => {
  test('a second instance for the same journal says it is already running', async ({ server }) => {
    const result = await runServerOnce({
      MOSS_DATA_DIR: server.dataDir,
      MOSS_PORT: String(server.port + 1),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /Mossnote is already running \(PID \d+\) at http:\/\/127\.0\.0\.1:\d+\./,
    );
  });

  test('a port that is in use names the port and MOSS_PORT', async ({ server }) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-port-'));
    const result = await runServerOnce({ MOSS_DATA_DIR: dataDir, MOSS_PORT: String(server.port) });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(String(server.port));
    expect(result.stderr).toContain('MOSS_PORT');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('a bad MOSS_JOURNAL is rejected before anything is created', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-name-'));
    const result = await runServerOnce({ MOSS_DATA_DIR: dataDir, MOSS_JOURNAL: '../escape' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('MOSS_JOURNAL');
    expect(fs.readdirSync(dataDir)).toEqual([]);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
