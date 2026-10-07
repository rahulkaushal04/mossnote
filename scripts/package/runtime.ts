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
export function ensureUnpacked(options: { archive: Buffer; root: string; id: string }): string {
  const { archive, root, id } = options;
  const target = path.join(root, id);
  if (fs.existsSync(path.join(target, READY))) return target;

  fs.mkdirSync(root, { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  const staging = `${target}.unpacking-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    extract(archive, staging);
    fs.writeFileSync(path.join(staging, READY), id);
    try {
      fs.renameSync(staging, target);
    } catch (error) {
      // Another copy finished first: use theirs.
      if (!fs.existsSync(path.join(target, READY))) throw error;
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return target;
}

/** Remove unpacked copies of other versions. A copy that is still in use cannot be removed on Windows; that is fine. */
export function pruneOthers(root: string, keepId: string): void {
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    if (name === keepId || name.includes('.unpacking-')) continue;
    try {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    } catch {
      // In use, or already gone.
    }
  }
}
