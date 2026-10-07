import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, AlreadyRunningError } from './lock';
import { makeTempDir, removeDir } from './testing/helpers';

let dir: string;
let lockPath: string;
beforeEach(() => {
  dir = makeTempDir();
  lockPath = path.join(dir, 'journal.lock');
});
afterEach(() => {
  removeDir(dir);
});

describe('acquireLock', () => {
  it('writes the PID and removes the file on release', () => {
    const lock = acquireLock(lockPath);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
    lock.release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('refuses a second instance while the first is alive', () => {
    const first = acquireLock(lockPath);
    expect(() => acquireLock(lockPath, 4_000_000)).toThrow(AlreadyRunningError);
    try {
      acquireLock(lockPath, 4_000_000);
    } catch (error) {
      expect((error as AlreadyRunningError).pid).toBe(process.pid);
    }
    first.release();
  });

  it('replaces a stale lock left by a process that is gone', () => {
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
    const deadPid = Number(child.stdout.toString());
    fs.writeFileSync(lockPath, String(deadPid));
    const lock = acquireLock(lockPath);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
    lock.release();
  });

  it('replaces an unreadable lock file', () => {
    fs.writeFileSync(lockPath, 'not a pid');
    const lock = acquireLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(true);
    lock.release();
  });

  it('does not remove a lock it no longer owns', () => {
    const lock = acquireLock(lockPath);
    fs.writeFileSync(lockPath, '12345');
    lock.release();
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('uses a separate lock per journal name', () => {
    const a = acquireLock(path.join(dir, 'a.lock'));
    const b = acquireLock(path.join(dir, 'b.lock'));
    a.release();
    b.release();
  });
});
