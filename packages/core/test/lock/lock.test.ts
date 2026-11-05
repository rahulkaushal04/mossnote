import { closeSync, copyFileSync, existsSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { BUSY_MESSAGE, acquireLock, lockGuard } from '../../src/lock/index.ts';
import { openStore } from '../../src/store/store.ts';
import { open, tmp } from '../store/helpers.ts';

/** Takes the lock from a different process (the real two-windows case). */
const otherProcess = (dir: string): string =>
  execFileSync(
    process.execPath,
    ['--import', 'tsx', join(import.meta.dirname, 'try-lock.ts'), dir],
    { encoding: 'utf8' },
  ).trim();

describe('CS-10 workspace lock', () => {
  it('a second open is unavailable (not corrupt) and leaves the db usable by the first', () => {
    const p = join(tmp(), 'n.db');
    const a = open(p, { guards: [lockGuard] });
    const b = openStore(p, { guards: [lockGuard] });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.error.code).toBe('unavailable');
    expect(b.error.message).toBe(BUSY_MESSAGE);
    expect(a.db.prepare('SELECT 1 AS x').get()).toEqual({ x: 1 });
  });

  it('close releases the lock', () => {
    const p = join(tmp(), 'n.db');
    open(p, { guards: [lockGuard] }).close();
    expect(openStore(p, { guards: [lockGuard] }).ok).toBe(true);
  });

  it('a guard failure after the lock was taken releases it', () => {
    const p = join(tmp(), 'n.db');
    const r = openStore(p, {
      guards: [lockGuard, () => ({ ok: false, error: { code: 'corrupt', message: 'x' } })],
    });
    expect(r.ok).toBe(false);
    expect(acquireLock(join(p, '..')).ok).toBe(true);
  });

  // The experiment the critic asked for: POSIX locks die when ANY fd on the same inode closes.
  it('closing other handles on the main DB, or on a copy of it, does not release the lock', () => {
    const dir = tmp();
    const p = join(dir, 'n.db');
    const a = open(p, { guards: [lockGuard] });
    a.db.pragma('wal_checkpoint(TRUNCATE)');
    for (let i = 0; i < 3; i++) new Database(p, { readonly: true }).close();
    new Database(p).close();
    copyFileSync(p, join(dir, 'copy.db'));
    new Database(join(dir, 'copy.db')).close();
    expect(existsSync(join(dir, 'workspace.lock'))).toBe(true);
    const b = openStore(p, { guards: [lockGuard] });
    expect(!b.ok && b.error.code).toBe('unavailable');
    expect(otherProcess(dir)).toBe('unavailable'); // the OS-level lock, as another window sees it
  });

  // Documented hazard: SQLite defers closing its own extra handles, but a raw fd close on the lock inode
  // drops the POSIX lock. This is why nothing else in-process may open workspace.lock.
  it('control: a raw fd open+close on the lock file itself releases the lock', () => {
    const dir = tmp();
    const l = acquireLock(dir);
    expect(l.ok).toBe(true);
    new Database(join(dir, 'workspace.lock')).close(); // SQLite handle: lock survives
    expect(otherProcess(dir)).toBe('unavailable');
    closeSync(openSync(join(dir, 'workspace.lock'), 'r')); // raw fd: the OS lock is lost
    expect(otherProcess(dir)).toBe('acquired');
    if (l.ok) l.value.release();
  });

  it('kill -9 of the holder releases the lock (no stale lock file problem)', async () => {
    const dir = tmp();
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', join(import.meta.dirname, 'hold-lock.ts'), dir],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    await new Promise<void>((res, rej) => {
      child.stdout.once('data', () => res());
      child.once('error', rej);
    });
    expect(otherProcess(dir)).toBe('unavailable');
    child.kill('SIGKILL');
    await new Promise((res) => child.once('exit', res));
    expect(existsSync(join(dir, 'workspace.lock'))).toBe(true); // the file stays; only the lock is gone
    expect(otherProcess(dir)).toBe('acquired');
  });
});
