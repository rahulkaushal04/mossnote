import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extract } from './archive';

/**
 * What the standalone program does with the app it carries: unpack it once into a per-version
 * folder in the user's cache, and reuse that folder on every later start. The cache is only code.
 * Journals are never kept in it, so clearing it is always safe and an upgrade is just a new folder.
 */

const READY = '.ready';

/** A short id for one build of the app, from its bytes. */
export function archiveId(version: string, archive: Buffer): string {
  return `${version}-${crypto.createHash('sha256').update(archive).digest('hex').slice(0, 12)}`;
}

/**
 * Unpack `archive` into `<root>/<id>` unless that folder already holds a finished copy.
 * Unpacking happens beside it and is renamed into place, so a crash or two copies starting at once
 * can never leave half an app where a finished one is expected.
 */
export interface UnpackOptions {
  archive: Buffer;
  root: string;
  id: string;
  rename?: (from: string, to: string) => void;
  attempts?: number;
  delayMs?: number;
}

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Unpack into `<root>/<id>` beside it and rename into place; retried, as antivirus can block the rename. */
export function ensureUnpacked(options: UnpackOptions): string {
  const { archive, root, id, rename = fs.renameSync, attempts = 25, delayMs = 200 } = options;
  const target = path.join(root, id);
  if (fs.existsSync(path.join(target, READY))) return target;

  fs.mkdirSync(root, { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  const staging = `${target}.unpacking-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    extract(archive, staging);
    fs.writeFileSync(path.join(staging, READY), id);
    for (let attempt = 1; ; attempt++) {
      try {
        rename(staging, target);
        break;
      } catch (error) {
        // Another copy finished first: use theirs.
        if (fs.existsSync(path.join(target, READY))) break;
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (!BUSY.has(code) || attempt >= attempts) throw error;
        pause(delayMs);
      }
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return target;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Remove other versions and the staging folders of processes that are gone. */
export function pruneOthers(root: string, keepId: string): void {
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    if (name === keepId) continue;
    const staging = /\.unpacking-(\d+)$/.exec(name);
    if (staging && isAlive(Number(staging[1]))) continue;
    try {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    } catch {
      // In use, or already gone.
    }
  }
}
