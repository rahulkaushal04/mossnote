import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, rmSync } from 'node:fs';
import type { AttachFs } from '../attachments/fsport.ts';
import { throwIfAborted, yieldTick } from './errors.ts';

export const MiB = 1024 * 1024;

export const fileChunks = (path: string): AsyncIterable<Buffer> =>
  createReadStream(path, { highWaterMark: MiB }) as AsyncIterable<Buffer>;

export async function hashFile(path: string): Promise<{ sha256: string; size: number }> {
  const h = createHash('sha256');
  let size = 0;
  for await (const c of fileChunks(path)) {
    h.update(c);
    size += c.length;
  }
  return { sha256: h.digest('hex'), size };
}

/** Writes an async byte stream to a NEW file (exclusive create), fsyncs and closes. Removes it on failure. */
export async function writeIterable(
  fs: AttachFs,
  path: string,
  src: AsyncIterable<Buffer>,
  signal?: AbortSignal,
): Promise<number> {
  const fd = fs.openNew(path);
  let total = 0;
  let sinceYield = 0;
  let ok = false;
  try {
    for await (const c of src) {
      throwIfAborted(signal);
      fs.write(fd, c, c.length);
      total += c.length;
      sinceYield += c.length;
      if (sinceYield >= 8 * MiB) {
        sinceYield = 0;
        await yieldTick();
      }
    }
    fs.fsync(fd);
    ok = true;
  } finally {
    try {
      fs.close(fd);
    } catch {
      /* ignore: the primary error matters */
    }
    if (!ok) {
      try {
        fs.unlink(path);
      } catch {
        /* ignore */
      }
    }
  }
  return total;
}

/** Wraps a stream and hashes what passes through. */
export function hashing(src: AsyncIterable<Buffer>) {
  const h = createHash('sha256');
  const st = { size: 0, digest: () => h.copy().digest('hex') };
  async function* gen(): AsyncGenerator<Buffer> {
    for await (const c of src) {
      h.update(c);
      st.size += c.length;
      yield c;
    }
  }
  return { stream: gen(), stat: st };
}

export function rmQuiet(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

export function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
