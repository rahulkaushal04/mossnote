import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, AlreadyRunningError } from './lock';
import { makeTempDir, removeDir } from './testing/helpers';

let dir: string;
let lockPath: string;
let other: ChildProcess;
let otherPid: number;
beforeEach(() => {
  dir = makeTempDir();
  lockPath = path.join(dir, 'journal.lock');
  other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  otherPid = other.pid!;
});
afterEach(() => {
  other.kill();
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

  it('replaces a lock written before this computer started, even if its pid is in use again', () => {
    const justBeforeBoot = Date.now() - 3 * 3_600_000;
    fs.writeFileSync(lockPath, String(otherPid));
    fs.utimesSync(lockPath, justBeforeBoot / 1000, justBeforeBoot / 1000);

    const lock = acquireLock(lockPath, process.pid, Date.now() - 3_600_000);

    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
    lock.release();
  });

  it('keeps refusing a lock written after this computer started', () => {
    fs.writeFileSync(lockPath, String(otherPid));

    expect(() => acquireLock(lockPath, process.pid, Date.now() - 3_600_000)).toThrow(
      AlreadyRunningError,
    );
  });

  it('names the lock file in the error', () => {
    fs.writeFileSync(lockPath, String(otherPid));

    expect(() => acquireLock(lockPath)).toThrow(expect.objectContaining({ lockPath }));
  });

  it('replaces an unreadable lock file', () => {
    fs.writeFileSync(lockPath, 'not a pid');
    const lock = acquireLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(true);
    lock.release();
  });

  describe('a lock whose owner is still writing it', () => {
    /** A process that, after `delayMs`, runs `action` on the lock file (the other launcher, midway). */
    const laterAct = (delayMs: number, action: 'write' | 'remove') => {
      const script = `
        const fs = require('node:fs');
        const [file, pid] = process.argv.slice(1);
        setTimeout(() => {
          ${action === 'write' ? 'fs.writeFileSync(file, pid)' : 'fs.rmSync(file, { force: true })'};
        }, ${delayMs});
      `;
      return spawn(process.execPath, ['-e', script, lockPath, String(otherPid)], {
        stdio: 'ignore',
      });
    };
    const fresh = () => fs.writeFileSync(lockPath, '');

    it('is not taken over: once its pid appears, the caller is refused', () => {
      fresh();
      const writer = laterAct(250, 'write');
      try {
        expect(() => acquireLock(lockPath, process.pid)).toThrow(AlreadyRunningError);
        expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(otherPid));
      } finally {
        writer.kill();
      }
    });

    it('is taken over when its owner lets go while the caller waits', () => {
      fresh();
      const remover = laterAct(250, 'remove');
      try {
        const lock = acquireLock(lockPath, process.pid);
        expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
        lock.release();
      } finally {
        remover.kill();
      }
    });

    it('is replaced once the wait is over if no pid ever appears', () => {
      fresh();
      const started = Date.now();
      const lock = acquireLock(lockPath, process.pid);
      expect(Date.now() - started).toBeGreaterThanOrEqual(800);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
      lock.release();
    });

    it('is replaced at once when it has been empty for a while, as after a crash', () => {
      fresh();
      const longAgo = (Date.now() - 60_000) / 1000;
      fs.utimesSync(lockPath, longAgo, longAgo);
      const started = Date.now();
      const lock = acquireLock(lockPath, process.pid);
      expect(Date.now() - started).toBeLessThan(500);
      expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
      lock.release();
    });
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
