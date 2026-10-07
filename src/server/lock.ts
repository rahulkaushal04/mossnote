import fs from 'node:fs';

/** Another live Mossnote process holds the lock for this journal. */
export class AlreadyRunningError extends Error {
  readonly pid: number;
  constructor(pid: number) {
    super(`Mossnote is already running (PID ${pid}).`);
    this.pid = pid;
  }
}

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
export function acquireLock(lockPath: string, pid: number = process.pid): Lock {
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
    if (Number.isInteger(holder) && holder !== pid && isAlive(holder)) {
      throw new AlreadyRunningError(holder);
    }
    // Stale or unreadable lock: remove it and try again.
    fs.rmSync(lockPath, { force: true });
  }
  throw new Error(`Could not acquire the lock file at ${lockPath}.`);
}
