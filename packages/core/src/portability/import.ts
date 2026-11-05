/**
 * Markdown-folder import (PT-3, PT-4, PT-5; decisions M4, M5, C3).
 *
 * Phase 1 walks the picked folder with lstat only (symlinks and special files are never followed or read),
 * and streams everything into a separate staging SQLite file `<dbDir>/.import-<ulid>.sqlite`, so memory
 * stays flat. Nothing touches the live database.
 * Phase 2 commits to the workspace: new ULIDs for every note and folder, all under a new top-level folder
 * "Imported <date>", in batches of at most 500 notes (one mutateMany transaction each). A resume marker in
 * the LIVE meta table is written inside each batch's transaction, so a kill -9 resumes at the next batch
 * and never duplicates. Attachment files are stored last, through the attachments API, and are
 * idempotent.
 */
import {
  closeSync,
  constants,
  createReadStream,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { AttachmentsApi } from '../attachments/index.ts';
import { rewriteFromRelative } from '../attachments/links.ts';
import { sanitizeName } from '../attachments/names.ts';
import { sha256 } from '../db/hash.ts';
import { getMeta, setMeta } from '../db/meta.ts';
import type { Clock } from '../db/types.ts';
import { createUlid } from '../ids/ulid.ts';
import { err, ok, type Result } from '../result.ts';
import type { Store, Tx } from '../store/store.ts';
import { tagKey } from '../tags/tags.ts';
import type { Progress } from './backup.ts';
import { throwIfAborted, toPortResult, yieldTick } from './errors.ts';
import { parseNote, titleFor } from './frontmatter.ts';
import { MiB, rmQuiet } from './io.ts';

export interface ImportLimits {
  maxDepth: number;
  maxFiles: number;
  maxDirs: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  batchNotes: number;
  batchBytes: number;
  reportRows: number;
}
export const IMPORT_LIMITS: ImportLimits = {
  maxDepth: 48, // + the "Imported" folder stays within CS-4's 50
  maxFiles: 200_000,
  maxDirs: 20_000,
  maxTotalBytes: 10 * 1024 * MiB,
  maxFileBytes: 10 * MiB,
  batchNotes: 500,
  batchBytes: 64 * MiB,
  reportRows: 5000,
};

export interface ImportFileReport {
  rel: string;
  status: 'added' | 'skipped' | 'repaired';
  reason: string;
}
export interface ImportReport {
  added: number;
  skipped: number;
  repaired: number;
  folderName: string;
  files: ImportFileReport[];
  /** More rows exist than `files` holds; the full report is in the report file. */
  truncated: boolean;
  reportFile: string;
  resumed: boolean;
  stoppedEarly?: string;
}

export interface ImportDeps {
  store: Store;
  attachments: AttachmentsApi;
  clock: Clock;
  limits?: Partial<ImportLimits>;
}
export interface ImportRequest {
  /** Absolute folder chosen in a main-process dialog. Ignored when an interrupted import is waiting. */
  dir?: string;
  onProgress?: Progress;
  signal?: AbortSignal;
  /** Test seam: called at named points; throw or SIGKILL to simulate a crash. */
  hook?: (label: string) => void;
}

const STAGE_SCHEMA = `
CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT;
CREATE TABLE folders(ord INTEGER PRIMARY KEY AUTOINCREMENT, rel TEXT NOT NULL UNIQUE, id TEXT NOT NULL,
  parent_rel TEXT, name TEXT NOT NULL, created INTEGER, updated INTEGER) STRICT;
CREATE TABLE notes(ord INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, rel TEXT NOT NULL, folder_rel TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
  favorite INTEGER NOT NULL, tags TEXT NOT NULL, batch INTEGER NOT NULL) STRICT;
CREATE INDEX notes_batch ON notes(batch);
CREATE TABLE atts(ord INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL,
  sha TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TABLE report(ord INTEGER PRIMARY KEY AUTOINCREMENT, rel TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL) STRICT;
`;

const exportManifest = z
  .object({
    format: z.literal('mossnote-export'),
    folders: z
      .array(z.object({ path: z.string().max(4096), name: z.string().min(1).max(255) }).passthrough())
      .max(100_000),
  })
  .passthrough();

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const caseFold = (p: string): string => (process.platform === 'linux' ? p : p.toLowerCase());
const stageName = (p: string): boolean => /^\.import-[0-9A-Z]{26}\.sqlite$/.test(basename(p));

function inside(parent: string, child: string): boolean {
  const a = caseFold(parent);
  const b = caseFold(child);
  return b === a || b.startsWith(a.endsWith(sep) ? a : a + sep);
}

/** Reads at most limit+1 bytes of a regular file opened without following symlinks. */
function readRegular(abs: string, lst: { dev: number; ino: number }, limit: number): Buffer | 'changed' | 'big' {
  const fd = openSync(abs, constants.O_RDONLY | NOFOLLOW | (constants.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.dev !== lst.dev || st.ino !== lst.ino) return 'changed';
    const buf = Buffer.alloc(Math.min(st.size, limit) + 1);
    let n = 0;
    while (n < buf.length) {
      const r = readSync(fd, buf, n, buf.length - n, null);
      if (r === 0) break;
      n += r;
    }
    return n > limit ? 'big' : buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

async function hashPath(path: string): Promise<{ sha: string; size: number }> {
  const h = createHash('sha256');
  let size = 0;
  for await (const c of createReadStream(path, { highWaterMark: MiB }) as AsyncIterable<Buffer>) {
    h.update(c);
    size += c.length;
  }
  return { sha: h.digest('hex'), size };
}

const dateLabel = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const findPendingImport = (dbDir: string): string | undefined => {
  let names: string[] = [];
  try {
    names = readdirSync(dbDir).filter((n) => stageName(n)).sort();
  } catch {
    return undefined;
  }
  for (const n of names.reverse()) {
    const p = join(dbDir, n);
    try {
      const db = new Database(p, { readonly: true, fileMustExist: true });
      try {
        const ready = db.prepare("SELECT v FROM meta WHERE k = 'ready'").get() as { v: string } | undefined;
        if (ready?.v === '1' && (db.pragma('quick_check', { simple: true }) as string) === 'ok') return p;
      } finally {
        db.close();
      }
    } catch {
      /* unreadable: treated as incomplete */
    }
  }
  return undefined;
};

/** Deletes staging files that never reached "ready" (a crash during phase 1). */
export function sweepImportStages(dbDir: string, keep?: string): void {
  try {
    for (const n of readdirSync(dbDir)) {
      const p = join(dbDir, n);
      if (stageName(n) && p !== keep && findPendingImport(dbDir) !== p) rmQuiet(p);
    }
  } catch {
    /* nothing to sweep */
  }
}

export async function runImport(d: ImportDeps, req: ImportRequest): Promise<Result<ImportReport>> {
  const dbDir = dirname(d.store.path);
  const hook = req.hook ?? (() => undefined);
  try {
    const pending = findPendingImport(dbDir);
    sweepImportStages(dbDir, pending);
    if (pending) return await commit(d, req, pending, true);
    if (!req.dir) return err('validation', 'Choose a folder to import.');
    const staged = await scan(d, req);
    if (!staged.ok) return staged;
    hook('scanned');
    return await commit(d, req, staged.value, false);
  } catch (e) {
    return toPortResult(e);
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Phase 1                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

async function scan(d: ImportDeps, req: ImportRequest): Promise<Result<string>> {
  const lim = { ...IMPORT_LIMITS, ...d.limits };
  const progress = req.onProgress ?? (() => undefined);
  const dir = req.dir!;
  if (!isAbsolute(dir)) return err('validation', 'The import location must be an absolute path.');
  const root = realpathSync(dir);
  if (!lstatSync(root).isDirectory()) return err('validation', 'Choose a folder to import.');
  const ws = realpathSync(dirname(d.store.path));
  if (inside(ws, root) || inside(root, ws))
    return err('validation', 'Choose a folder that is not the Mossnote data folder or one that contains it.');

  const ulid = createUlid(() => d.clock.now());
  const importId = ulid();
  const stagePath = join(dirname(d.store.path), `.import-${importId}.sqlite`);
  const sdb = new Database(stagePath);
  let ready = false;
  try {
    sdb.pragma('journal_mode = DELETE');
    sdb.pragma('synchronous = OFF');
    sdb.exec(STAGE_SCHEMA);
    const put = sdb.prepare("INSERT INTO meta(k, v) VALUES (?, ?)");
    const insFolder = sdb.prepare('INSERT INTO folders(rel, id, parent_rel, name, created, updated) VALUES (?,?,?,?,?,?)');
    const insNote = sdb.prepare(
      'INSERT INTO notes(id, rel, folder_rel, title, body, created, updated, favorite, tags, batch) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    const insAtt = sdb.prepare('INSERT INTO atts(note_id, path, name, sha) VALUES (?,?,?,?)');
    const insRep = sdb.prepare('INSERT INTO report(rel, status, reason) VALUES (?,?,?)');
    let inTx = 0;
    const tick = (): void => {
      if (inTx === 0) sdb.exec('BEGIN');
      if (++inTx >= 500) {
        sdb.exec('COMMIT');
        inTx = 0;
      }
    };
    const flush = (): void => {
      if (inTx > 0) {
        sdb.exec('COMMIT');
        inTx = 0;
      }
    };
    const report = (rel: string, status: ImportFileReport['status'], reason: string): void => {
      tick();
      insRep.run(rel, status, reason);
    };

    // The export manifest (when present and valid) restores exact folder names.
    const names = new Map<string, string>();
    try {
      const mp = join(root, 'mossnote-export.json');
      const ms = lstatSync(mp);
      if (ms.isFile() && ms.size <= 16 * MiB) {
        const p = exportManifest.safeParse(JSON.parse(readFileSync(mp, 'utf8')));
        if (p.success) for (const f of p.data.folders) names.set(f.path, f.name);
      }
    } catch {
      /* no manifest */
    }

    const now = d.clock.now();
    const rootName = `Imported ${dateLabel(now)}`;
    const rootId = ulid();
    put.run('importId', importId);
    put.run('rootId', rootId);
    put.run('rootName', rootName);
    put.run('source', basename(root));
    tick();
    insFolder.run('', rootId, null, rootName, null, null);

    let nFolders = 0;
    let nFiles = 0;
    let nNotes = 0;
    let totalBytes = 0;
    let stopped: string | undefined;
    let batch = 0;
    let inBatch = 0;
    let batchBytes = 0;
    const cache = new Map<string, { sha: string; size: number } | null>();
    const stack: { abs: string; rel: string; depth: number }[] = [{ abs: root, rel: '', depth: 0 }];

    const resolveLink = (noteAbs: string, dest: string): string | undefined => {
      try {
        const abs = resolve(dirname(noteAbs), dest);
        const rel = relative(root, abs);
        if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
        const real = realpathSync(abs);
        if (!inside(root, real) || !statSync(real).isFile()) return undefined;
        return real;
      } catch {
        return undefined;
      }
    };
    const maxAtt = d.attachments.maxBytes();

    while (stack.length && !stopped) {
      const cur = stack.pop()!;
      let entries: string[] = [];
      try {
        const dh = opendirSync(cur.abs);
        try {
          for (let e = dh.readSync(); e; e = dh.readSync()) entries.push(e.name);
        } finally {
          dh.closeSync();
        }
      } catch {
        report(cur.rel || '.', 'skipped', 'folder could not be read');
        continue;
      }
      entries = entries.sort();
      for (const name of entries) {
        throwIfAborted(req.signal);
        const rel = cur.rel ? `${cur.rel}/${name}` : name;
        if (LONE_SURROGATE.test(name) || name.includes('\0') || name.startsWith('.')) {
          report(rel, 'skipped', 'hidden or invalid name');
          continue;
        }
        const abs = join(cur.abs, name);
        let lst: Stats;
        try {
          lst = lstatSync(abs);
        } catch {
          report(rel, 'skipped', 'could not be read');
          continue;
        }
        if (lst.isSymbolicLink()) {
          report(rel, 'skipped', 'symbolic link (not followed)');
        } else if (lst.isDirectory()) {
          if (cur.depth === 0 && name === '_attachments') continue; // referenced by links, not a folder of notes
          if (cur.depth >= lim.maxDepth) {
            report(rel, 'skipped', 'folders nest too deeply');
            continue;
          }
          if (++nFolders > lim.maxDirs) {
            stopped = `stopped after ${lim.maxDirs} folders`;
            break;
          }
          let fname = names.get(rel) ?? name;
          fname = [...fname.normalize('NFC').trim()].slice(0, 255).join('') || name;
          tick();
          insFolder.run(rel, ulid(), cur.rel, fname, null, null);
          stack.push({ abs, rel, depth: cur.depth + 1 });
        } else if (lst.isFile()) {
          const ext = extname(name).toLowerCase();
          if (ext !== '.md' && ext !== '.markdown') continue;
          if (++nFiles > lim.maxFiles) {
            stopped = `stopped after ${lim.maxFiles} files`;
            break;
          }
          if (lst.size > lim.maxFileBytes) {
            report(rel, 'skipped', 'larger than 10 MB');
            continue;
          }
          totalBytes += lst.size;
          if (totalBytes > lim.maxTotalBytes) {
            stopped = 'stopped at the total size limit';
            break;
          }
          let raw: Buffer | 'changed' | 'big';
          try {
            raw = readRegular(abs, lst, lim.maxFileBytes);
          } catch {
            report(rel, 'skipped', 'could not be read');
            continue;
          }
          if (raw === 'big') {
            report(rel, 'skipped', 'larger than 10 MB');
            continue;
          }
          if (raw === 'changed') {
            report(rel, 'skipped', 'changed while it was being read');
            continue;
          }
          let text: string;
          try {
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
          } catch {
            report(rel, 'skipped', 'not valid UTF-8 text');
            continue;
          }
          if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
          const p = parseNote(text);
          const mtime = Math.round(lst.mtimeMs);
          const updated = p.updated ?? mtime;
          let created = p.created ?? Math.min(mtime, Math.round(lst.birthtimeMs) || mtime);
          if (created > updated) created = updated;
          const stem = name.slice(0, name.length - ext.length);
          let body = p.body;
          const reasons = [...p.reasons];
          // Attachments: resolve relative links, hash the files, rewrite only verified ones (M8).
          const cands = new Set<string>();
          rewriteFromRelative(body, (dest) => {
            const r = resolveLink(abs, dest);
            if (r) cands.add(r);
            return undefined;
          });
          const found: { path: string; sha: string }[] = [];
          for (const c of cands) {
            if (!cache.has(c)) {
              let h: { sha: string; size: number } | null = null;
              try {
                const s = statSync(c);
                if (s.size <= maxAtt) h = await hashPath(c);
              } catch {
                h = null;
              }
              cache.set(c, h);
            }
          }
          const rw = rewriteFromRelative(body, (dest) => {
            const r = resolveLink(abs, dest);
            return r ? (cache.get(r)?.sha ?? undefined) : undefined;
          });
          if (rw.replaced.length) {
            body = rw.text;
            for (const c of cands) {
              const h = cache.get(c);
              if (h && rw.replaced.includes(h.sha)) found.push({ path: c, sha: h.sha });
            }
          }
          const noteId = ulid();
          if (inBatch >= lim.batchNotes || (inBatch > 0 && batchBytes >= lim.batchBytes)) {
            batch++;
            inBatch = 0;
            batchBytes = 0;
          }
          inBatch++;
          batchBytes += Buffer.byteLength(body);
          tick();
          insNote.run(
            noteId,
            rel,
            cur.rel,
            titleFor(p, stem),
            body,
            created,
            updated,
            p.favorite ? 1 : 0,
            JSON.stringify(p.tags),
            batch,
          );
          const seen = new Set<string>();
          for (const f of found) {
            if (seen.has(f.sha)) continue;
            seen.add(f.sha);
            tick();
            insAtt.run(noteId, f.path, sanitizeName(basename(f.path)), f.sha);
          }
          nNotes++;
          report(rel, reasons.length ? 'repaired' : 'added', reasons.join('; '));
          if (nNotes % 100 === 0) {
            progress('scanning', nNotes, 0);
            await yieldTick();
          }
        } else {
          report(rel, 'skipped', 'not a regular file');
        }
      }
    }
    flush();
    if (stopped) report('.', 'skipped', stopped);
    flush();
    sdb.prepare("INSERT INTO meta(k, v) VALUES ('notes', ?)").run(String(nNotes));
    sdb.prepare("INSERT INTO meta(k, v) VALUES ('batches', ?)").run(String(nNotes ? batch + 1 : 0));
    if (stopped) sdb.prepare("INSERT INTO meta(k, v) VALUES ('stopped', ?)").run(stopped);
    sdb.prepare("INSERT INTO meta(k, v) VALUES ('ready', '1')").run();
    ready = true;
    return ok(stagePath);
  } finally {
    try {
      sdb.close();
    } catch {
      /* ignore */
    }
    if (!ready) rmQuiet(stagePath);
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Phase 2                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

interface StagedNote {
  ord: number;
  id: string;
  folder_rel: string;
  title: string;
  body: string;
  created: number;
  updated: number;
  favorite: number;
  tags: string;
}

function insertBatch(tx: Tx, rows: StagedNote[], folderIds: Map<string, string>): Result<number> {
  const tagIds = new Map<string, string>();
  const tagByKey = tx.db.prepare('SELECT id FROM tags WHERE name_key = ?');
  const insTag = tx.db.prepare('INSERT INTO tags(id, name, name_key, created_at, updated_at, device_id) VALUES (?,?,?,?,?,?)');
  const insNote = tx.db.prepare(
    `INSERT INTO notes(id, folder_id, title, body, content_hash, rev, favorite, head_version_id,
       created_at, updated_at, device_id) VALUES (?,?,?,?,?,1,?,NULL,?,?,?)`,
  );
  const insVer = tx.db.prepare(
    `INSERT INTO versions(id, note_id, title, body, content_hash, reason, parent_version_id,
       created_at, device_id, actor_id) VALUES (?,?,?,?,?,'edit',NULL,?,?,NULL)`,
  );
  const head = tx.db.prepare('UPDATE notes SET head_version_id = ? WHERE id = ?');
  const link = tx.db.prepare('INSERT OR IGNORE INTO note_tags(note_id, tag_id, created_at) VALUES (?,?,?)');
  for (const r of rows) {
    const folderId = folderIds.get(r.folder_rel);
    if (!folderId) return err('internal', 'import staging is inconsistent');
    const h = sha256(r.body);
    insNote.run(r.id, folderId, r.title, r.body, h, r.favorite, r.created, r.updated, tx.deviceId);
    const v = tx.ulid();
    insVer.run(v, r.id, r.title, r.body, h, r.updated, tx.deviceId);
    head.run(v, r.id);
    const l = tx.log({
      entity: 'note',
      entityId: r.id,
      op: 'create',
      fields: { title: r.title, folderId, favorite: r.favorite === 1 },
      noteVersionId: v,
      contentHash: h,
    });
    if (!l.ok) return l;
    for (const name of JSON.parse(r.tags) as string[]) {
      const key = tagKey(name);
      let tid = tagIds.get(key) ?? (tagByKey.get(key) as { id: string } | undefined)?.id;
      if (!tid) {
        tid = tx.ulid();
        insTag.run(tid, name, key, tx.now, tx.now, tx.deviceId);
        const tl = tx.log({ entity: 'tag', entityId: tid, op: 'create', fields: { name } });
        if (!tl.ok) return tl;
      }
      tagIds.set(key, tid);
      link.run(r.id, tid, tx.now);
      const nl = tx.log({ entity: 'note_tag', entityId: `${r.id}:${tid}`, op: 'update', fields: { present: true } });
      if (!nl.ok) return nl;
    }
  }
  return ok(rows.length);
}

async function commit(d: ImportDeps, req: ImportRequest, stagePath: string, resumed: boolean): Promise<Result<ImportReport>> {
  const { store } = d;
  const lim = { ...IMPORT_LIMITS, ...d.limits };
  const progress = req.onProgress ?? (() => undefined);
  const hook = req.hook ?? (() => undefined);
  const sdb = new Database(stagePath);
  try {
    const meta = (k: string): string | undefined =>
      (sdb.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v;
    const importId = meta('importId')!;
    const rootName = meta('rootName')!;
    const total = Number(meta('notes'));
    const batches = Number(meta('batches'));
    const key = `import_${importId}`;
    const folders = sdb.prepare('SELECT rel, id, parent_rel, name FROM folders ORDER BY ord').all() as {
      rel: string;
      id: string;
      parent_rel: string | null;
      name: string;
    }[];
    const folderIds = new Map(folders.map((f) => [f.rel, f.id]));
    let step = Number(getMeta(store.db, key) ?? 0);

    if (step < 1) {
      const r = store.mutateMany({}, (tx) => {
        for (const f of folders) {
          const parent = f.parent_rel === null ? null : folderIds.get(f.parent_rel)!;
          tx.db
            .prepare('INSERT INTO folders(id, parent_id, name, created_at, updated_at, device_id) VALUES (?,?,?,?,?,?)')
            .run(f.id, parent, f.name, tx.now, tx.now, tx.deviceId);
          const l = tx.log({ entity: 'folder', entityId: f.id, op: 'create', fields: { name: f.name, parentId: parent } });
          if (!l.ok) return l;
        }
        setMeta(tx.db, key, '1');
        return ok(undefined);
      });
      if (!r.ok) return r;
      step = 1;
    }
    hook('folders');
    const q = sdb.prepare(
      'SELECT ord, id, folder_rel, title, body, created, updated, favorite, tags FROM notes WHERE batch = ? ORDER BY ord',
    );
    for (let b = step - 1; b < batches; b++) {
      throwIfAborted(req.signal);
      const rows = q.all(b) as StagedNote[];
      const r = store.mutateMany({}, (tx) => {
        const n = insertBatch(tx, rows, folderIds);
        if (!n.ok) return n;
        setMeta(tx.db, key, String(b + 2)); // atomic with the batch: the resume marker
        return n;
      });
      if (!r.ok) return r;
      progress('importing', Math.min(total, (b + 1) * lim.batchNotes), total);
      hook(`batch:${b}`);
      await yieldTick();
    }

    // Attachment files last, through the attachments API (hash-checked, deduplicated, idempotent).
    const warns: string[] = [];
    const todo = sdb.prepare('SELECT ord, note_id, path, name, sha FROM atts WHERE done = 0 ORDER BY ord');
    const done = sdb.prepare('UPDATE atts SET done = 1 WHERE ord = ?');
    const addRep = sdb.prepare("INSERT INTO report(rel, status, reason) VALUES (?, 'skipped', ?)");
    for (const a of todo.all() as { ord: number; note_id: string; path: string; name: string; sha: string }[]) {
      throwIfAborted(req.signal);
      const r = await d.attachments.addFromPath({}, a.note_id, a.path, a.name);
      if (!r.ok || r.value.sha256 !== a.sha) {
        addRep.run(a.name, 'attachment could not be stored; its link stays unresolved');
        warns.push(a.name);
      }
      done.run(a.ord);
      hook(`attachment:${a.ord}`);
    }

    const cnt = (s: string): number =>
      (sdb.prepare("SELECT count(*) AS n FROM report WHERE status = ?").get(s) as { n: number }).n;
    const rows = sdb
      .prepare("SELECT rel, status, reason FROM report ORDER BY (status = 'added'), ord LIMIT ?")
      .all(lim.reportRows) as ImportFileReport[];
    const all = sdb.prepare('SELECT rel, status, reason FROM report ORDER BY ord').all() as ImportFileReport[];
    const reportFile = 'import-report.json';
    const rp = join(dirname(store.path), reportFile);
    writeFileSync(`${rp}.tmp`, JSON.stringify({ importedAt: new Date(d.clock.now()).toISOString(), folder: rootName, files: all }));
    renameSync(`${rp}.tmp`, rp);
    const stopped = meta('stopped');
    const result: ImportReport = {
      added: cnt('added'),
      skipped: cnt('skipped'),
      repaired: cnt('repaired'),
      folderName: rootName,
      files: rows,
      truncated: all.length > rows.length,
      reportFile,
      resumed,
      ...(stopped ? { stoppedEarly: stopped } : {}),
    };
    sdb.close();
    rmQuiet(stagePath);
    store.mutate({}, (tx) => {
      tx.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
      return ok(undefined);
    });
    return ok(result);
  } catch (e) {
    return toPortResult(e);
  } finally {
    try {
      sdb.close();
    } catch {
      /* already closed */
    }
  }
}

