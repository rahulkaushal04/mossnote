import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { ulid } from 'ulid';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface MossServer {
  url: string;
  port: number;
  dataDir: string;
  /** Stop the server and wait for it to exit (the data folder is kept). */
  stop(): Promise<void>;
  /** Kill it without any chance to clean up (SIGKILL), as a crash would. */
  kill(): Promise<void>;
  /** Start it again on the same port and data folder. */
  start(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitForHealth(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`Server at ${url} did not start in time.`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function launch(port: number, dataDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [path.join(root, 'dist', 'server', 'index.js')], {
    cwd: root,
    // Set E2E_SERVER_LOG=1 to see the server's output while debugging a test.
    stdio: process.env.E2E_SERVER_LOG ? 'inherit' : 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MOSS_PORT: String(port),
      MOSS_DATA_DIR: dataDir,
      MOSS_OPEN_BROWSER: '0',
      MOSS_LOG_LEVEL: process.env.E2E_SERVER_LOG ? 'debug' : 'error',
    },
  });
  await waitForHealth(`http://127.0.0.1:${port}`);
  return child;
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else
      child.once('exit', () => {
        resolve();
      });
  });
}

const HEADERS = { 'X-Moss-Client': 'web' };

/** An empty, valid export: importing it resets the journal (data and settings) between tests. */
const EMPTY_JOURNAL = {
  format: 'mossnote',
  formatVersion: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  journalName: 'journal',
  settings: {
    calendar: {
      seasons: [
        { name: 'Spring', days: 28 },
        { name: 'Summer', days: 28 },
        { name: 'Fall', days: 28 },
        { name: 'Winter', days: 28 },
      ],
    },
    currentGameDate: null,
    prefs: { readingSize: 'comfortable' },
  },
  tags: [],
  people: [],
  plantings: [],
  notes: [],
};

/** Seeding helpers. Every call goes through the real API, with the guard headers. */
export class Seed {
  constructor(
    private readonly request: APIRequestContext,
    readonly url: string,
  ) {}

  private async send<T>(
    method: 'post' | 'patch' | 'delete',
    path: string,
    data?: unknown,
  ): Promise<T> {
    const response = await this.request.fetch(`${this.url}${path}`, {
      method,
      headers: HEADERS,
      ...(data === undefined ? {} : { data }),
    });
    if (!response.ok())
      throw new Error(`${method} ${path} failed: ${response.status()} ${await response.text()}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  post<T = unknown>(path: string, data: unknown): Promise<T> {
    return this.send<T>('post', path, data);
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.request.get(`${this.url}${path}`);
    if (!response.ok()) throw new Error(`GET ${path} failed: ${response.status()}`);
    return (await response.json()) as T;
  }

  reset(): Promise<unknown> {
    return this.send('post', '/api/data/import', EMPTY_JOURNAL);
  }
  settings(patch: unknown): Promise<unknown> {
    return this.send('patch', '/api/settings', patch);
  }
  note(body: Record<string, unknown>): Promise<{ id: string; createdAt: string }> {
    return this.send('post', '/api/notes', { id: ulid(), ...body });
  }
  person(name: string, extra: Record<string, unknown> = {}): Promise<{ id: string }> {
    return this.send('post', '/api/people', { id: ulid(), name, ...extra });
  }
  planting(label: string, extra: Record<string, unknown> = {}): Promise<{ id: string }> {
    return this.send('post', '/api/plantings', { id: ulid(), label, ...extra });
  }
  patchNote(id: string, body: Record<string, unknown>): Promise<unknown> {
    return this.send('patch', `/api/notes/${id}`, body);
  }
  notes(
    query = '',
  ): Promise<{ items: { id: string; body: string; gameDate: number | null; tags: string[] }[] }> {
    return this.get(`/api/notes?limit=100${query}`);
  }
}

interface Fixtures {
  /** A clean journal and seeding helpers; the journal is reset before every test. */
  seed: Seed;
}

/** Worker-scoped: one real server per Playwright worker, on a free port with a temp data folder. */
export const test = base.extend<Fixtures, { server: MossServer }>({
  server: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-e2e-'));
      const port = await freePort();
      let child = await launch(port, dataDir);
      const server: MossServer = {
        url: `http://127.0.0.1:${port}`,
        port,
        dataDir,
        async stop() {
          child.kill('SIGTERM');
          await exited(child);
        },
        async kill() {
          child.kill('SIGKILL');
          await exited(child);
        },
        async start() {
          child = await launch(port, dataDir);
        },
      };
      await use(server);
      child.kill('SIGTERM');
      await exited(child);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },
  seed: [
    async ({ server, request }, use) => {
      const seed = new Seed(request, server.url);
      await seed.reset();
      await use(seed);
    },
    { auto: true },
  ],
});

/** Spawn a throwaway server process that is expected to fail, and return how it ended. */
export async function runServerOnce(env: Record<string, string>): Promise<{
  code: number | null;
  stderr: string;
  stdout: string;
}> {
  const child = spawn(process.execPath, [path.join(root, 'dist', 'server', 'index.js')], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', MOSS_OPEN_BROWSER: '0', ...env },
  });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  clearTimeout(timer);
  return { code, stderr, stdout };
}

export { expect };
