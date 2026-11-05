import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/** Streams `source` to `dest` through a sibling temp file, so a failed copy never leaves a half-written file at `dest`. */
export async function copyOut(source: Readable, dest: string): Promise<void> {
  const part = `${dest}.mossnote-part`;
  try {
    await pipeline(source, fs.createWriteStream(part, { flags: 'w', mode: 0o644 })); // never executable
    fs.renameSync(part, dest);
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  }
}
