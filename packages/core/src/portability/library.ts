/** The backup library: `<dbDir>/backups/*.mossbak` (+ the older pre-migration `.sqlite` files, listed only). */
import { closeSync, openSync, readSync, statSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { isEncrypted, HEADER_LEN } from './crypto.ts';
import { listDir } from './io.ts';
import { ATT_PREFIX, MANIFEST_ENTRY, manifestSchema, TRAILER_ENTRY, type Manifest } from './package.ts';
import { BLOCK, padFor, parseHeader } from './tar.ts';

export type BackupKind = 'auto' | 'manual' | 'pre-migration';
export interface BackupSummary {
  /** File name inside the library. The only handle the renderer ever holds. */
  id: string;
  kind: BackupKind;
  createdAt: number;
  size: number;
  encrypted: boolean;
  /** Structure and trailer checked cheaply (not the full hash: use verify). Encrypted files can only be size-checked. */
  valid: boolean;
  /** false for pre-migration files (no manifest, no note count: not restorable from the UI). */
  restorable: boolean;
  noteCount?: number;
  /** Blobs that failed their own hash when the backup was written: restoring works but they are marked damaged. */
  damaged?: number;
}

export const libraryDir = (dbPath: string): string => join(dirname(dbPath), 'backups');
export const ID_RE = /^backup-(\d{8}T\d{6}Z)-(auto|manual)-([0-9A-Z]{26})\.mossbak$/;
const PRE_RE = /^pre-migration-v\d+-[0-9A-Z]{26}\.sqlite$/;

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
export const backupName = (ms: number, kind: 'auto' | 'manual', ulid: string): string =>
  `backup-${stamp(ms)}-${kind}-${ulid}.mossbak`;

function parseStamp(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s)!;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
}

function readAt(fd: number, pos: number, len: number): Buffer | undefined {
  const b = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = readSync(fd, b, off, len - off, pos + off);
    if (n === 0) return undefined;
    off += n;
  }
  return b;
}

/** Reads the trailer and manifest from the tail and checks that the file size matches the entry sizes. */
export function inspectPlain(path: string, size: number): { valid: boolean; manifest?: Manifest } {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    if (size < BLOCK * 6) return { valid: false };
    const th = readAt(fd, size - 4 * BLOCK, BLOCK);
    const td = readAt(fd, size - 3 * BLOCK, BLOCK);
    if (!th || !td) return { valid: false };
    const t = parseHeader(th);
    if (t === 'end' || t.name !== TRAILER_ENTRY || t.size > 200) return { valid: false };
    const m = /^([0-9a-f]{64}) (\d+)\n$/.exec(td.toString('latin1', 0, t.size));
    if (!m) return { valid: false };
    const msize = Number(m[2]);
    const mStart = size - 4 * BLOCK - padFor(msize) - msize - BLOCK;
    if (mStart < 0) return { valid: false };
    const mh = parseHeader(readAt(fd, mStart, BLOCK)!);
    if (mh === 'end' || mh.name !== MANIFEST_ENTRY || mh.size !== msize || msize > 64 * 1024 * 1024)
      return { valid: false };
    const mb = readAt(fd, mStart + BLOCK, msize);
    if (!mb || createHash('sha256').update(mb).digest('hex') !== m[1]) return { valid: false };
    const p = manifestSchema.safeParse(JSON.parse(mb.toString('utf8')));
    if (!p.success) return { valid: false };
    const mf = p.data;
    const entry = (n: number): number => BLOCK + n + padFor(n);
    let expect = entry(mf.db.size) + entry(msize) + entry(t.size) + 2 * BLOCK;
    const dmg = new Map(mf.damaged.map((d) => [d.sha256, d.reason]));
    for (const a of mf.attachments) expect += entry(a.size);
    // Damaged-but-present blobs have an entry of unknown size here; the full verify checks them.
    const unknownCorrupt = [...dmg.values()].some((r) => r === 'corrupt');
    return { valid: unknownCorrupt ? size >= expect : size === expect, manifest: mf };
  } catch {
    return { valid: false };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function readHead(path: string, n: number): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const b = Buffer.alloc(n);
    const got = readSync(fd, b, 0, n, 0);
    return b.subarray(0, got);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Newest first. Never throws; `*.tmp` files and anything not named like a backup are ignored. */
export function listLibrary(dbPath: string): BackupSummary[] {
  const dir = libraryDir(dbPath);
  const out: BackupSummary[] = [];
  for (const f of listDir(dir)) {
    const path = join(dir, f);
    try {
      const m = ID_RE.exec(f);
      if (m) {
        const size = statSync(path).size;
        const enc = isEncrypted(readHead(path, 8));
        const ins = enc ? { valid: size > HEADER_LEN + 16 } : inspectPlain(path, size);
        out.push({
          id: f,
          kind: m[2] as 'auto' | 'manual',
          createdAt: parseStamp(m[1]!),
          size,
          encrypted: enc,
          valid: ins.valid,
          restorable: ins.valid,
          ...('manifest' in ins && ins.manifest
            ? { noteCount: ins.manifest.noteCount, damaged: ins.manifest.damaged.length }
            : {}),
        });
      } else if (PRE_RE.test(f)) {
        const st = statSync(path);
        out.push({
          id: f,
          kind: 'pre-migration',
          createdAt: Math.round(st.mtimeMs),
          size: st.size,
          encrypted: false,
          valid: readHead(path, 16).toString('latin1') === 'SQLite format 3\0',
          restorable: false,
        });
      }
    } catch {
      /* vanished */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
}

/** A path only for an id that the listing returns (so `..` and other names can never resolve). */
export function resolveId(dbPath: string, id: string): string | undefined {
  if (typeof id !== 'string' || !(ID_RE.test(id) || PRE_RE.test(id))) return undefined;
  return listLibrary(dbPath).some((b) => b.id === id) ? join(libraryDir(dbPath), id) : undefined;
}

export function deleteBackup(dbPath: string, id: string): boolean {
  const p = resolveId(dbPath, id);
  if (!p) return false;
  try {
    unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

export const ATTACHMENT_ENTRY = (sha: string): string => `${ATT_PREFIX}${sha}`;
export const libraryBytes = (dbPath: string): number => listLibrary(dbPath).reduce((a, b) => a + b.size, 0);
