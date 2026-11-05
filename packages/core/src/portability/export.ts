/** Markdown export (PT-1, PT-2, PT-9, PT-12, PT-13). Deterministic; streams; never writes outside the target. */
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, utimesSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import Database from 'better-sqlite3';
import type { AttachFs } from '../attachments/fsport.ts';
import { attachmentShasIn, rewriteToRelative } from '../attachments/links.ts';
import { extensionOf, sanitizeName } from '../attachments/names.ts';
import { blobPathIn } from '../attachments/scan.ts';
import { EXECUTABLE_EXTENSIONS } from '../attachments/sniff.ts';
import type { Clock } from '../db/types.ts';
import { createUlid } from '../ids/ulid.ts';
import { err, ok, type Result } from '../result.ts';
import type { Store } from '../store/store.ts';
import type { Progress } from './backup.ts';
import { throwIfAborted, toPortResult, yieldTick } from './errors.ts';
import { serializeFrontmatter } from './frontmatter.ts';
import { rmQuiet, MiB } from './io.ts';
import { reservedRootNames, uniqueName, within } from './names.ts';
import { snapshotTo } from './snapshot.ts';

export type ExportScope = { kind: 'all' } | { kind: 'notes'; ids: string[] };
export interface ExportDeps {
  store: Store;
  root: string;
  fs: AttachFs;
  clock: Clock;
}
export interface ExportRequest {
  /** Absolute directory chosen by the user in a main-process dialog. */
  dir: string;
  scope: ExportScope;
  onProgress?: Progress;
  signal?: AbortSignal;
}
export interface ExportResult {
  folderName: string;
  path: string;
  notes: number;
  attachments: number;
  warnings: string[];
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
}

const MAX_WARNINGS = 50;

export async function runExport(d: ExportDeps, req: ExportRequest): Promise<Result<ExportResult>> {
  const { store, fs } = d;
  const ulid = createUlid(() => d.clock.now());
  const progress = req.onProgress ?? (() => undefined);
  const warnings: string[] = [];
  const warn = (m: string): void => {
    if (warnings.length < MAX_WARNINGS) warnings.push(m);
  };
  let tmpDir: string | undefined;
  const snap = join(dirname(store.path), `.export-${ulid()}.sqlite`);
  let snapDb: InstanceType<typeof Database> | undefined;
  try {
    if (!isAbsolute(req.dir)) return err('validation', 'The export location must be an absolute path.');
    const target = realpathSync(req.dir);
    if (!lstatSync(target).isDirectory()) return err('validation', 'Choose a folder for the export.');
    const wsDir = realpathSync(dirname(store.path));
    if (target === wsDir || target.startsWith(wsDir + sep))
      return err('validation', 'Choose a folder outside the Mossnote data folder.');

    await snapshotTo(store, snap);
    snapDb = new Database(snap, { readonly: true, fileMustExist: true });
    const db = snapDb;

    tmpDir = join(target, `.mossnote-export-${ulid()}.tmp`);
    mkdirSync(tmpDir, { mode: 0o700 });
    const out = tmpDir;

    // --- folder tree (live folders only: a trashed folder hides its whole subtree) ---
    const all = db
      .prepare('SELECT id, parent_id, name, created_at, updated_at, trashed_at FROM folders')
      .all() as FolderRow[];
    const byId = new Map(all.map((f) => [f.id, f]));
    const dead = new Map<string, boolean>();
    const isDead = (id: string): boolean => {
      const hit = dead.get(id);
      if (hit !== undefined) return hit;
      dead.set(id, false);
      const f = byId.get(id);
      const v = !f || f.trashed_at !== null || (f.parent_id !== null && isDead(f.parent_id));
      dead.set(id, v);
      return v;
    };
    const children = new Map<string | null, FolderRow[]>();
    for (const f of all) {
      if (isDead(f.id)) continue;
      const k = f.parent_id;
      const arr = children.get(k) ?? [];
      arr.push(f);
      children.set(k, arr);
    }
    for (const arr of children.values())
      arr.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    let wanted: Set<string> | undefined;
    let needed: Set<string> | undefined;
    if (req.scope.kind === 'notes') {
      wanted = new Set(req.scope.ids);
      needed = new Set<string>();
      const rows = db
        .prepare('SELECT id, folder_id FROM notes WHERE id IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify([...wanted])) as { id: string; folder_id: string | null }[];
      for (const r of rows) {
        let cur = r.folder_id;
        while (cur !== null && !needed.has(cur)) {
          needed.add(cur);
          cur = byId.get(cur)?.parent_id ?? null;
        }
      }
    }

    const total = (db.prepare('SELECT count(*) AS n FROM notes WHERE trashed_at IS NULL').get() as { n: number }).n;
    const tagQ = db.prepare(
      'SELECT t.name AS name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name_key',
    );
    const attQ = db.prepare('SELECT size FROM attachments WHERE sha256 = ?');
    const refQ = db.prepare('SELECT name FROM note_attachments WHERE sha256 = ? ORDER BY created_at, id LIMIT 1');
    const noteQ = db.prepare(
      'SELECT id, title, body, favorite, created_at, updated_at FROM notes WHERE folder_id IS ? AND trashed_at IS NULL ORDER BY title, id',
    );

    const folderManifest: { path: string; id: string; name: string; createdAt: number; updatedAt: number }[] = [];
    const blobs = new Map<string, { file: string; size: number } | null>();
    let noteCount = 0;
    let sinceYield = 0;

    const writeNew = (path: string, data: Buffer): void => {
      const fd = fs.openNew(path);
      try {
        fs.write(fd, data, data.length);
      } finally {
        fs.close(fd);
      }
    };

    const ensureBlob = (sha: string): { file: string; size: number } | null => {
      if (blobs.has(sha)) return blobs.get(sha)!;
      let result: { file: string; size: number } | null = null;
      const row = attQ.get(sha) as { size: number } | undefined;
      if (!row) warn('A note links to an attachment that is not in this workspace; the link was left as is.');
      else {
        const ref = refQ.get(sha) as { name: string } | undefined;
        let ext = extensionOf(sanitizeName(ref?.name ?? ''));
        if (EXECUTABLE_EXTENSIONS.has(ext)) ext = '.dat'; // never write a launchable extension
        if (!/^\.[a-z0-9]{1,10}$/.test(ext)) ext = '';
        const file = `${sha}${ext}`;
        let sfd: number | undefined;
        let dfd: number | undefined;
        const dest = within(out, `_attachments/${file}`);
        try {
          fs.mkdirp(join(out, '_attachments'));
          sfd = fs.openRead(blobPathIn(d.root, sha));
          if (!fs.fstat(sfd).isFile) throw new Error('not a file');
          dfd = fs.openNew(dest);
          const h = createHash('sha256');
          const buf = Buffer.alloc(MiB);
          let n = 0;
          for (;;) {
            const r = fs.read(sfd, buf, MiB);
            if (r === 0) break;
            h.update(buf.subarray(0, r));
            fs.write(dfd, buf, r);
            n += r;
          }
          if (h.digest('hex') === sha && n === row.size) result = { file, size: n };
          else warn('An attachment failed its checksum and was not exported; the link was left as is.');
        } catch (e) {
          const c = (e as { code?: unknown }).code;
          if (c === 'ENOSPC' || c === 'EDQUOT' || c === 'EACCES' || c === 'EPERM' || c === 'EROFS') throw e;
          warn('An attachment file is missing and was not exported; the link was left as is.');
        } finally {
          for (const fd of [sfd, dfd])
            if (fd !== undefined)
              try {
                fs.close(fd);
              } catch {
                /* ignore */
              }
          if (!result && dfd !== undefined) rmQuiet(dest);
        }
      }
      blobs.set(sha, result);
      return result;
    };

    const exportDir = async (folderId: string | null, rel: string, depth: number, used: Set<string>): Promise<void> => {
      for (const f of children.get(folderId) ?? []) {
        if (needed && !needed.has(f.id)) continue;
        const dirName = uniqueName(f.name, '', used);
        const frel = rel ? `${rel}/${dirName}` : dirName;
        mkdirSync(within(out, frel), { recursive: true, mode: 0o700 });
        folderManifest.push({ path: frel, id: f.id, name: f.name, createdAt: f.created_at, updatedAt: f.updated_at });
        await exportDir(f.id, frel, depth + 1, new Set());
      }
      for (const n of noteQ.iterate(folderId) as Iterable<{
        id: string;
        title: string;
        body: string;
        favorite: number;
        created_at: number;
        updated_at: number;
      }>) {
        if (wanted && !wanted.has(n.id)) continue;
        throwIfAborted(req.signal);
        const map = new Map<string, string>();
        for (const sha of attachmentShasIn(n.body)) {
          const b = ensureBlob(sha);
          if (b) map.set(sha, `${'../'.repeat(depth)}_attachments/${b.file}`);
        }
        const body = map.size ? rewriteToRelative(n.body, map).text : n.body;
        const tags = (tagQ.all(n.id) as { name: string }[]).map((t) => t.name);
        const text =
          serializeFrontmatter({
            id: n.id,
            title: n.title,
            tags,
            favorite: n.favorite === 1,
            created: n.created_at,
            updated: n.updated_at,
          }) + body;
        const fileName = uniqueName(n.title, '.md', used);
        const abs = within(out, rel ? `${rel}/${fileName}` : fileName);
        writeNew(abs, Buffer.from(text, 'utf8'));
        utimesSync(abs, n.updated_at / 1000, n.updated_at / 1000);
        noteCount++;
        if (++sinceYield >= 200) {
          sinceYield = 0;
          progress('writing', noteCount, total);
          await yieldTick();
        }
      }
    };

    await exportDir(null, '', 0, reservedRootNames());
    progress('writing', noteCount, total);
    const manifest = {
      format: 'mossnote-export',
      version: 1,
      folders: folderManifest.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      notes: noteCount,
      attachments: [...blobs.entries()]
        .filter((e): e is [string, { file: string; size: number }] => e[1] !== null)
        .map(([sha256, v]) => ({ sha256, size: v.size, file: v.file }))
        .sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1)),
    };
    writeNew(join(out, 'mossnote-export.json'), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
    fs.fsyncDir(out);

    // Claim a final name with mkdir (never overwrites), then move the finished tree onto it.
    const day = new Date(d.clock.now()).toISOString().slice(0, 10);
    let finalName = '';
    for (let n = 1; ; n++) {
      finalName = n === 1 ? `Mossnote export ${day}` : `Mossnote export ${day} (${n})`;
      try {
        mkdirSync(join(target, finalName));
        break;
      } catch (e) {
        if ((e as { code?: unknown }).code !== 'EEXIST' || n > 10_000) throw e;
      }
    }
    renameSync(out, join(target, finalName));
    tmpDir = undefined;
    fs.fsyncDir(target);
    return ok({
      folderName: finalName,
      path: join(target, finalName),
      notes: noteCount,
      attachments: manifest.attachments.length,
      warnings,
    });
  } catch (e) {
    return toPortResult(e);
  } finally {
    try {
      snapDb?.close();
    } catch {
      /* ignore */
    }
    for (const p of [snap, `${snap}-wal`, `${snap}-shm`]) rmQuiet(p);
    if (tmpDir) rmQuiet(tmpDir);
  }
}
