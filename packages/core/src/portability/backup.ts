import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../migrations/index.ts';
import type { AttachFs } from '../attachments/fsport.ts';
import { blobPathIn } from '../attachments/scan.ts';
import { getMeta } from '../db/meta.ts';
import type { Clock } from '../db/types.ts';
import { createUlid } from '../ids/ulid.ts';
import { indexVerdict } from '../integrity/check.ts';
import { err, ok, type Result } from '../result.ts';
import type { Store } from '../store/store.ts';
import { decryptStream, encryptStream, isEncrypted, type CryptoParams } from './crypto.ts';
import { NO_SPACE, PortError, throwIfAborted, toPortResult } from './errors.ts';
import { fileChunks, hashing, MiB, rmQuiet, writeIterable } from './io.ts';
import { backupName, deleteBackup, libraryDir, listLibrary, readHead } from './library.ts';
import {
  ATT_PREFIX,
  DB_ENTRY,
  MANIFEST_ENTRY,
  readPackage,
  TRAILER_ENTRY,
  type Manifest,
  type ReadResult,
} from './package.ts';
import { snapshotTo, countOf } from './snapshot.ts';
import { padFor, tarHeader, TAR_END } from './tar.ts';

export const SCHEMA_LATEST = MIGRATIONS.length;
export type Progress = (phase: string, done: number, total: number) => void;

export interface BackupDeps {
  store: Store;
  /** Attachments blob directory. */
  root: string;
  fs: AttachFs;
  clock: Clock;
  appVersion?: string;
  /** Test seam: cheaper scrypt / smaller chunks. */
  crypto?: CryptoParams;
}
export interface BackupRequest {
  kind: 'auto' | 'manual';
  /** Absolute path chosen by the user (main-process dialog). Omitted = the library. */
  file?: string;
  passphrase?: string;
  onProgress?: Progress;
  signal?: AbortSignal;
}
export interface BackupResult {
  id: string;
  path: string;
  size: number;
  encrypted: boolean;
  noteCount: number;
  attachments: number;
  /** Blobs that failed their own hash. The package exists and is restorable, but is flagged incomplete. */
  damaged: { sha256: string; reason: 'missing' | 'corrupt' }[];
  verified: true;
}

const zeros = (n: number): Buffer => Buffer.alloc(n);

/** The plaintext tar stream of a package file, decrypting when it is encrypted. */
export function packageSource(path: string, passphrase?: string): AsyncIterable<Buffer> {
  if (isEncrypted(readHead(path, 8))) {
    if (!passphrase) throw new PortError('validation', 'This backup is encrypted. Enter its passphrase.');
    return decryptStream(fileChunks(path), passphrase);
  }
  return fileChunks(path);
}

/** Full read-back check: structure, every hash, manifest consistency. Throws PortError. */
export async function verifyPackageFile(
  path: string,
  passphrase?: string,
  signal?: AbortSignal,
  maxSchema = SCHEMA_LATEST,
): Promise<ReadResult> {
  return await readPackage(packageSource(path, passphrase), {}, { maxSchema, maxTotal: Infinity, signal });
}

export async function createBackup(d: BackupDeps, req: BackupRequest): Promise<Result<BackupResult>> {
  const { store, fs } = d;
  const ulid = createUlid(() => d.clock.now());
  const now = d.clock.now();
  const progress = req.onProgress ?? (() => undefined);
  let finalPath: string;
  if (req.file !== undefined) {
    if (!isAbsolute(req.file)) return err('validation', 'The backup location must be an absolute path.');
    finalPath = /\.mossbak$/i.test(req.file) ? req.file : `${req.file}.mossbak`;
  } else finalPath = join(libraryDir(store.path), backupName(now, req.kind, ulid()));
  const outDir = dirname(finalPath);
  const tmp = `${finalPath}.${ulid()}.tmp`;
  const snap = join(libraryDir(store.path), `.snap-${ulid()}.sqlite`);
  try {
    fs.mkdirp(outDir);
    fs.mkdirp(dirname(snap));
    throwIfAborted(req.signal);
    // Free space: the snapshot plus the package must both fit (twice the expected size, decision M11).
    const dbBytes = [store.path, `${store.path}-wal`].reduce((a, p) => {
      try {
        return a + statSync(p).size;
      } catch {
        return a;
      }
    }, 0);
    const blobBytes = (store.db.prepare('SELECT coalesce(sum(size), 0) AS n FROM attachments').get() as { n: number }).n;
    const free = Math.min(fs.freeBytes(outDir) ?? Infinity, fs.freeBytes(dirname(snap)) ?? Infinity);
    if (free < 2 * (dbBytes + blobBytes) + 64 * MiB) return err('io', NO_SPACE);

    progress('snapshot', 0, 1);
    await snapshotTo(store, snap);
    const sdb = new Database(snap, { readonly: true, fileMustExist: true });
    let noteCount: number;
    let folderCount: number;
    let rows: { sha256: string; size: number }[];
    let schemaVersion: number;
    try {
      const bad = (sdb.pragma('quick_check') as { quick_check: string }[]).find((r) => r.quick_check !== 'ok');
      // Damage confined to the (rebuildable) search tables must not stop a backup of the real data.
      if (bad && indexVerdict(snap) !== 'index')
        return err('corrupt', 'The workspace failed its integrity check, so no backup was made.');
      noteCount = countOf(sdb, 'notes');
      folderCount = countOf(sdb, 'folders');
      schemaVersion = sdb.pragma('user_version', { simple: true }) as number;
      rows = sdb.prepare('SELECT sha256, size FROM attachments ORDER BY sha256').all() as typeof rows;
    } finally {
      sdb.close();
    }
    const dbSize = statSync(snap).size;
    const good: { sha256: string; size: number }[] = [];
    const damaged: BackupResult['damaged'] = [];
    let dbSha = '';

    async function* plain(): AsyncGenerator<Buffer> {
      yield tarHeader(DB_ENTRY, dbSize);
      const h = hashing(fileChunks(snap));
      for await (const c of h.stream) yield c;
      if (h.stat.size !== dbSize) throw new PortError('io', 'The database snapshot changed while it was being copied.');
      dbSha = h.stat.digest();
      yield zeros(padFor(dbSize));
      const buf = Buffer.alloc(MiB);
      let i = 0;
      for (const row of rows) {
        throwIfAborted(req.signal);
        progress('writing', i++, rows.length);
        let fd: number | undefined;
        try {
          fd = fs.openRead(blobPathIn(d.root, row.sha256));
        } catch {
          damaged.push({ sha256: row.sha256, reason: 'missing' });
          continue;
        }
        try {
          const st = fs.fstat(fd);
          if (!st.isFile) {
            damaged.push({ sha256: row.sha256, reason: 'missing' });
            continue;
          }
          yield tarHeader(`${ATT_PREFIX}${row.sha256}`, st.size);
          const hh = createHash('sha256');
          let left = st.size;
          while (left > 0) {
            const n = fs.read(fd, buf, Math.min(MiB, left));
            if (n === 0) break;
            hh.update(buf.subarray(0, n));
            left -= n;
            yield Buffer.from(buf.subarray(0, n));
          }
          if (left > 0) for (let z = left; z > 0; z -= Math.min(z, MiB)) yield zeros(Math.min(z, MiB)); // shrank
          yield zeros(padFor(st.size));
          if (left === 0 && hh.digest('hex') === row.sha256 && st.size === row.size)
            good.push({ sha256: row.sha256, size: st.size });
          else damaged.push({ sha256: row.sha256, reason: 'corrupt' });
        } finally {
          try {
            fs.close(fd);
          } catch {
            /* ignore */
          }
        }
      }
      damaged.sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1));
      const manifest: Manifest = {
        format: 'mossnote-backup',
        version: 1,
        kind: req.kind,
        createdAt: new Date(now).toISOString(),
        appVersion: d.appVersion ?? '0',
        schemaVersion,
        workspaceId: store.workspaceId,
        sourceDeviceId: store.deviceId,
        noteCount,
        folderCount,
        db: { size: dbSize, sha256: dbSha },
        attachments: good,
        damaged,
      };
      const mb = Buffer.from(JSON.stringify(manifest), 'utf8');
      const trailer = Buffer.from(`${createHash('sha256').update(mb).digest('hex')} ${mb.length}\n`, 'latin1');
      yield tarHeader(MANIFEST_ENTRY, mb.length);
      yield mb;
      yield zeros(padFor(mb.length));
      yield tarHeader(TRAILER_ENTRY, trailer.length);
      yield trailer;
      yield zeros(padFor(trailer.length));
      yield TAR_END;
    }

    const stream = req.passphrase ? encryptStream(plain(), req.passphrase, d.crypto) : plain();
    await writeIterable(fs, tmp, stream, req.signal);
    // Read back what was written before it may be called a backup (C2).
    progress('verifying', 0, 1);
    let rb: ReadResult;
    try {
      rb = await verifyPackageFile(tmp, req.passphrase, req.signal, Math.max(SCHEMA_LATEST, schemaVersion));
    } catch (e) {
      rmQuiet(tmp);
      if (e instanceof PortError && e.code === 'unavailable') throw e;
      return err('internal', 'The backup could not be verified after writing, so it was discarded.', e);
    }
    if (rb.dbSha !== dbSha) {
      rmQuiet(tmp);
      return err('internal', 'The backup could not be verified after writing, so it was discarded.');
    }
    fs.rename(tmp, finalPath);
    fs.fsyncDir(outDir);
    progress('done', 1, 1);
    return ok({
      id: basename(finalPath),
      path: finalPath,
      size: statSync(finalPath).size,
      encrypted: !!req.passphrase,
      noteCount,
      attachments: good.length,
      damaged,
      verified: true,
    });
  } catch (e) {
    rmQuiet(tmp);
    return toPortResult(e);
  } finally {
    for (const p of [snap, `${snap}-wal`, `${snap}-shm`]) rmQuiet(p);
  }
}

/**
 * Retention: runs ONLY after a newer backup was read back clean. Keeps the newest `keep` automatic
 * backups and the newest 3 pre-migration copies; manual backups are never touched.
 */
export function pruneLibrary(dbPath: string, keep: number): string[] {
  const all = listLibrary(dbPath);
  const removed: string[] = [];
  const drop = (list: { id: string }[], n: number) => {
    for (const b of list.slice(n)) if (deleteBackup(dbPath, b.id)) removed.push(b.id);
  };
  drop(all.filter((b) => b.kind === 'auto'), Math.max(1, keep));
  drop(all.filter((b) => b.kind === 'pre-migration'), 3);
  return removed;
}

export const lastAutoAt = (store: Store): number => Number(getMeta(store.db, 'backup_last_auto_at') ?? 0);
