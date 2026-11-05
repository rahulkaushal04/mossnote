import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { toAppError } from '../db/errors.ts';
import { err, ok, type Result } from '../result.ts';
import type { OpenGuard } from '../store/store.ts';

const MAGIC = 'SQLite format 3\0';

export interface BackupInfo {
  path: string;
  mtimeMs: number;
  /** Read-only quick_check of the backup passed. */
  verified: boolean;
}
/** `error.cause` of a recovery-mode `corrupt` result. */
export interface RecoveryInfo {
  reason: string;
  dbPath: string;
  /** Newest first. */
  backups: BackupInfo[];
}

/** Read-only quick_check. Never opens read-write, so it cannot modify the file. */
export function quickCheck(path: string): Result<string> {
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true, timeout: 0 });
    const rows = db.pragma('quick_check') as { quick_check: string }[];
    const bad = rows.find((r) => r.quick_check !== 'ok');
    return ok(bad ? bad.quick_check : 'ok');
  } catch (e) {
    return toAppError(e); // BUSY -> unavailable, NOTADB/CORRUPT -> corrupt, never conflated
  } finally {
    db?.close();
  }
}

function hasMagic(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    return readSync(fd, buf, 0, 16, 0) === 16 && buf.toString('latin1') === MAGIC;
  } finally {
    closeSync(fd);
  }
}

/** Never throws: an unreadable directory gives [], an unreadable or vanished file is skipped. */
export function listBackups(dbPath: string): BackupInfo[] {
  const dir = join(dirname(dbPath), 'backups');
  const out: BackupInfo[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const f of names) {
    if (!f.endsWith('.sqlite')) continue;
    const path = join(dir, f);
    try {
      const q = quickCheck(path);
      out.push({ path, mtimeMs: statSync(path).mtimeMs, verified: q.ok && q.value === 'ok' });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// Rows that name a search object. Only these may be attributed to the (rebuildable) search tables.
const FTS_ROW = /\b(note_fts\w*|search_doc|search_stash|sqlite_autoindex_search_\w+)\b/;

type Raw = InstanceType<typeof Database> & { unsafeMode(on: boolean): void };
type Checked = { rows: string[]; thrown?: { code: string; message: string } };

/** Every row of a full (not table-restricted) quick_check; rows emitted before a throw are kept. */
function fullCheck(db: InstanceType<typeof Database>): Checked {
  const rows: string[] = [];
  try {
    for (const r of db.prepare('PRAGMA quick_check').iterate() as Iterable<{
      quick_check: string;
    }>)
      rows.push(r.quick_check);
  } catch (e) {
    const x = e as { code?: unknown; message?: unknown };
    return { rows, thrown: { code: String(x.code), message: String(x.message) } };
  }
  return { rows };
}

/**
 * What a FULL quick_check says about the file, judged by evidence that is LOGICALLY attributable to the
 * rebuildable FTS tables:
 *  - 'clean'   nothing wrong.
 *  - 'index'   the thrown fts5 config/structure SQLITE_ERROR, or rows that name note_fts/search_* objects,
 *              while everything else (every base table, freelist, page accounting) passes.
 *  - 'corrupt' anything else: a freelist, unused-page or double-reference row, an unnamed "Tree ..." row,
 *              an unattributable "malformed" throw. A table-restricted quick_check(<t>) skips page
 *              accounting, so it can never prove a database healthy (verified: a corrupt freelist passes it).
 * An fts5 config error aborts the check before the page accounting runs, so that case re-runs the full
 * check on an in-memory copy with the config row restored.
 */
export function indexVerdict(dbPath: string): 'clean' | 'index' | 'corrupt' {
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 0 });
    let c = fullCheck(db);
    let repaired = false;
    if (c.thrown) {
      if (c.thrown.code !== 'SQLITE_ERROR' || !/fts5/i.test(c.thrown.message)) return 'corrupt';
      const copy = new Database(db.serialize()) as Raw;
      try {
        copy.unsafeMode(true);
        copy.exec("INSERT OR REPLACE INTO note_fts_config(k, v) VALUES ('version', 4)");
        c = fullCheck(copy);
      } finally {
        copy.close();
      }
      if (c.thrown) return 'corrupt';
      repaired = true;
    }
    const bad = c.rows.filter((r) => r !== 'ok');
    if (!bad.every((r) => !r.startsWith('***') && FTS_ROW.test(r))) return 'corrupt';
    return bad.length || repaired ? 'index' : 'clean';
  } catch {
    return 'corrupt';
  } finally {
    db?.close();
  }
}

/** Header magic, then read-only quick_check, before any read-write open. A missing or empty file is a new workspace. */
export function checkIntegrity(dbPath: string): Result<void> {
  const r = assess(dbPath);
  return r.ok ? ok(undefined) : r;
}

/** checkIntegrity, plus whether the only damage is in the search tables (open anyway, rebuild). */
export function assess(dbPath: string): Result<{ indexDamaged: boolean }> {
  const clean = { indexDamaged: false };
  let reason: string | undefined;
  try {
    if (!existsSync(dbPath) || statSync(dbPath).size === 0) return ok(clean);
    if (!hasMagic(dbPath)) reason = 'not a SQLite database (bad header)';
  } catch (e) {
    return toAppError(e);
  }
  if (!reason) {
    const q = quickCheck(dbPath);
    if (q.ok && q.value === 'ok') return ok(clean);
    // A damaged fts5 config row makes quick_check throw SQLITE_ERROR ('internal'); busy/io are not corruption.
    if (!q.ok && q.error.code !== 'corrupt' && q.error.code !== 'internal') return q;
    reason = q.ok ? `quick_check: ${q.value}` : q.error.message;
    if (indexVerdict(dbPath) === 'index') return ok({ indexDamaged: true });
  }
  const info: RecoveryInfo = { reason, dbPath, backups: listBackups(dbPath) };
  return err('corrupt', `Workspace database is corrupt: ${reason}`, info);
}

/** Recovery mode: the guard fails with `corrupt` (cause: RecoveryInfo); the file is left untouched. */
export const integrityGuard: OpenGuard = (path) => {
  const r = assess(path);
  return r.ok ? ok(r.value.indexDamaged ? { indexDamaged: true } : undefined) : r;
};
