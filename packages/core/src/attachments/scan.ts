import { join } from 'node:path';
import type { Db } from '../db/types.ts';
import type { AttachFs } from './fsport.ts';
import { yieldTick } from './lock.ts';

export const HEX64 = /^[0-9a-f]{64}$/;
/** Every 64-hex window, overlapping, case-insensitive: a false positive only KEEPS a file. */
const WINDOW = /(?=([0-9a-f]{64}))/gi;
const SLICE_ROWS = 25;

/** Where a blob lives: <root>/ab/cd/<sha256>. */
export const blobPathIn = (root: string, sha: string): string =>
  join(root, sha.slice(0, 2), sha.slice(2, 4), sha);

export function addShas(text: string, into: Set<string>): void {
  if (text.length < 64) return;
  for (const m of text.matchAll(WINDOW)) into.add(m[1]!.toLowerCase());
}

const TABLES = [
  { table: 'notes', key: 'id', first: '', time: 'updated_at' },
  { table: 'versions', key: 'id', first: '', time: 'created_at' },
  { table: 'drafts', key: 'seq', first: 0, time: 'saved_at' },
] as const;

/**
 * Every 64-hex string in any note, version or draft body (trash included: trashed notes stay in
 * `notes`). Read in slices with a yield between them, so the write lock is never held and the UI stays
 * responsive (decision M12). Rows written while it runs are caught by `mentionedSince` later.
 */
export async function scanMentions(db: Db): Promise<Set<string>> {
  const out = new Set<string>();
  for (const t of TABLES) {
    const q = db.prepare(
      `SELECT ${t.key} AS k, body FROM ${t.table} WHERE ${t.key} > ? ORDER BY ${t.key} LIMIT ?`,
    );
    let cursor: string | number = t.first;
    for (;;) {
      const rows = q.all(cursor, SLICE_ROWS) as { k: string | number; body: string }[];
      if (rows.length === 0) break;
      for (const r of rows) addShas(r.body, out);
      cursor = rows[rows.length - 1]!.k;
      await yieldTick();
    }
  }
  return out;
}

/** Synchronous re-check of only the rows written at or after `since`; call inside the delete transaction. */
export function mentionedSince(db: Db, since: number, sha: string): boolean {
  const needle = sha.toLowerCase();
  for (const t of TABLES) {
    const rows = db
      .prepare(`SELECT body FROM ${t.table} WHERE ${t.time} >= ?`)
      .all(since) as { body: string }[];
    for (const r of rows) {
      const s = new Set<string>();
      addShas(r.body, s);
      if (s.has(needle)) return true;
    }
  }
  return false;
}

/** Blob files on disk (2-level shard layout). Ignores .tmp and anything not named like a sha256. */
export function listDiskBlobs(fs: AttachFs, root: string): { sha256: string; path: string }[] {
  const out: { sha256: string; path: string }[] = [];
  const safeList = (p: string): string[] => {
    try {
      return fs.readdir(p);
    } catch {
      return [];
    }
  };
  for (const a of safeList(root)) {
    if (!/^[0-9a-f]{2}$/.test(a)) continue;
    for (const b of safeList(join(root, a))) {
      if (!/^[0-9a-f]{2}$/.test(b)) continue;
      for (const f of safeList(join(root, a, b))) {
        if (HEX64.test(f) && f.startsWith(a + b)) out.push({ sha256: f, path: join(root, a, b, f) });
      }
    }
  }
  return out;
}

/** Deletes leftover temp files of interrupted adds. Best effort, never throws. */
export function sweepTmp(fs: AttachFs, root: string): number {
  const dir = join(root, '.tmp');
  let n = 0;
  try {
    for (const f of fs.readdir(dir)) {
      try {
        fs.unlink(join(dir, f));
        n++;
      } catch {
        /* leave it for the next start */
      }
    }
  } catch {
    /* no temp dir yet */
  }
  return n;
}
