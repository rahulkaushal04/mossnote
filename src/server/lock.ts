import fs from 'node:fs';
import os from 'node:os';

/** Another live Mossnote process holds the lock for this journal. */
export class AlreadyRunningError extends Error {
  readonly pid: number;
  readonly lockPath: string;
  constructor(pid: number, lockPath = '') {
    super(`Mossnote is already running (PID ${pid}).`);
    this.pid = pid;
    this.lockPath = lockPath;
  }
}

const BOOT_MARGIN_MS = 60_000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface Lock {
  release(): void;
}

/**
 * PID lock file (`<journal>.lock`). A second server for the same journal refuses to start; a lock
 * left by a process that no longer exists is replaced.
 */
export function acquireLock(
  lockPath: string,
  pid: number = process.pid,
  bootedAt: number = Date.now() - os.uptime() * 1000,
): Lock {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(lockPath, String(pid), { flag: 'wx', mode: 0o600 });
      return {
        release() {
          try {
            if (fs.readFileSync(lockPath, 'utf8').trim() === String(pid)) fs.unlinkSync(lockPath);
          } catch {
            // Already gone: nothing to release.
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const holder = Number.parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
    // a lock from before the computer started names a pid that now belongs to something else; the
    // margin covers the clock being corrected after start
    const leftBeforeBoot = fs.statSync(lockPath).mtimeMs < bootedAt - BOOT_MARGIN_MS;
    if (Number.isInteger(holder) && holder !== pid && isAlive(holder) && !leftBeforeBoot) {
      throw new AlreadyRunningError(holder, lockPath);
    }
    // Stale or unreadable lock: remove it and try again.
    fs.rmSync(lockPath, { force: true });
  }
  throw new Error(`Could not acquire the lock file at ${lockPath}.`);
}
