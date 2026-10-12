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

// A lock file is made first and its pid written a moment later, so another process can find it
// empty while its owner is midway. An empty file that new is read again for up to this long.
const WRITE_GRACE_MS = 1_000;
const POLL_MS = 10;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The pid in a lock file, and when the file was last written; null when it is gone. A file that is
 * empty and only just made is waited on rather than judged: its owner has not written yet.
 */
function readLock(lockPath: string): { holder: number; writtenAt: number } | null {
  const giveUp = Date.now() + WRITE_GRACE_MS;
  for (;;) {
    let text: string;
    let writtenAt: number;
    try {
      text = fs.readFileSync(lockPath, 'utf8');
      writtenAt = fs.statSync(lockPath).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const beingWritten =
      text.trim() === '' && Date.now() - writtenAt < WRITE_GRACE_MS && Date.now() < giveUp;
    if (!beingWritten) return { holder: Number.parseInt(text, 10), writtenAt };
    sleep(POLL_MS);
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

/** True when the lock names nobody who is still running, so it can be replaced. */
function isStale(
  found: { holder: number; writtenAt: number },
  pid: number,
  bootedAt: number,
): boolean {
  // a lock from before the computer started names a pid that now belongs to something else; the
  // margin covers the clock being corrected after start
  const leftBeforeBoot = found.writtenAt < bootedAt - BOOT_MARGIN_MS;
  const held = Number.isInteger(found.holder) && found.holder !== pid && isAlive(found.holder);
  return !held || leftBeforeBoot;
}

/**
 * Remove a lock that was judged stale, so that no other process removes or makes it at the same
 * moment: two callers that both found it stale would otherwise both replace it, the second one
 * removing the first one's new lock. Only the holder of `<lock>.takeover` removes, and it looks
 * again first. False means the caller should look at the lock again.
 */
function removeStale(lockPath: string, pid: number, bootedAt: number): boolean {
  const guard = `${lockPath}.takeover`;
  try {
    fs.writeFileSync(guard, String(pid), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // Another process is replacing it. Wait for that to finish, unless the file is left from one
    // that died partway.
    const giveUp = Date.now() + WRITE_GRACE_MS;
    while (Date.now() < giveUp) {
      try {
        if (Date.now() - fs.statSync(guard).mtimeMs >= WRITE_GRACE_MS) {
          fs.rmSync(guard, { force: true });
          break;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw statError;
      }
      sleep(POLL_MS);
    }
    return false;
  }
  try {
    const now = readLock(lockPath);
    if (now !== null && !isStale(now, pid, bootedAt)) return false;
    fs.rmSync(lockPath, { force: true });
    return true;
  } finally {
    fs.rmSync(guard, { force: true });
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
    const found = readLock(lockPath);
    // Let go between our attempt and our look: try to make it again.
    if (found === null) continue;
    if (!isStale(found, pid, bootedAt)) throw new AlreadyRunningError(found.holder, lockPath);
    // Stale or unreadable lock: remove it and try again.
    removeStale(lockPath, pid, bootedAt);
  }
  throw new Error(`Could not acquire the lock file at ${lockPath}.`);
}
