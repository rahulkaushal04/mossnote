import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../src/server/testing/helpers';
import { API_ARGS } from './dev-command';

/**
 * The npm scripts run TypeScript through tsx, which does not know the Vitest or Vite aliases.
 * These tests run the real entry points the way the scripts do, so a broken alias or a missing
 * tsconfig flag fails here instead of on a user's machine.
 */
const root = path.resolve('.');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');

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

describe('npm script entry points', () => {
  it('the dev server entry boots under tsx, serves the API and shuts down cleanly', async () => {
    const dataDir = makeTempDir();
    const port = await freePort();
    // Same arguments as `npm run dev`, without `watch` so the process is simple to stop.
    const child = spawn(
      tsx,
      API_ARGS.filter((arg) => arg !== 'watch'),
      {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          MOSS_DATA_DIR: dataDir,
          MOSS_PORT: String(port),
          MOSS_OPEN_BROWSER: '0',
          MOSS_LOG_LEVEL: 'error',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    try {
      let health: Response | undefined;
      for (let i = 0; i < 100 && !health?.ok; i++) {
        if (child.exitCode !== null) break;
        health = await fetch(`http://127.0.0.1:${port}/api/health`).catch(() => undefined);
        if (!health?.ok) await new Promise((r) => setTimeout(r, 150));
      }
      expect(stderr).toBe('');
      expect(health?.ok).toBe(true);
      expect(fs.existsSync(path.join(dataDir, 'journal.db'))).toBe(true);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
      removeDir(dataDir);
    }
  }, 30_000);

  it('db:vacuum runs under tsx against a journal', () => {
    const dataDir = makeTempDir();
    // Create the journal by starting and stopping the real server entry once.
    const created = spawnSync(
      tsx,
      [
        '--tsconfig',
        'tsconfig.server.json',
        '-e',
        "import('./src/server/boot.ts').then(async (b) => { const c = (await import('./src/server/config.ts')).loadConfig(); const { createLogger } = await import('./src/server/logger.ts'); const j = await b.openJournal({ config: c, clock: { now: () => Date.now() }, logger: createLogger('error'), migrationsFolder: process.cwd() + '/drizzle' }); j.close(); });",
      ],
      { cwd: root, env: { ...process.env, MOSS_DATA_DIR: dataDir }, encoding: 'utf8' },
    );
    expect(created.stderr).toBe('');
    const vacuum = spawnSync('npm', ['run', '--silent', 'db:vacuum'], {
      cwd: root,
      env: { ...process.env, MOSS_DATA_DIR: dataDir },
      encoding: 'utf8',
    });
    expect(vacuum.stderr).toBe('');
    expect(vacuum.status).toBe(0);
    expect(vacuum.stdout).toMatch(/Vacuumed .*journal\.db/);
    removeDir(dataDir);
  }, 60_000);
});
