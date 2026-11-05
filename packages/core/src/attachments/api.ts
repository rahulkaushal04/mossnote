import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { redactFields } from '../changelog/append.ts';
import type { Db } from '../db/types.ts';
import { createUlid } from '../ids/ulid.ts';
import { err, ok, type Result } from '../result.ts';
import { afterPurge } from '../search/damage.ts';
import type { Ctx, Store } from '../store/store.ts';
import { noteIsTrashed, parse, safe } from '../trash/derive.ts';
import { nodeAttachFs, type AttachFs } from './fsport.ts';
import { attachmentUrl, markdownFor } from './links.ts';
import { createJobMutex, createKeyedLock, yieldTick } from './lock.ts';
import { sanitizeName } from './names.ts';
import { clearOrphanText } from './orphan.ts';
import { createForkExtractor, type PdfTextExtractor } from './pdfText.ts';
import {
  blobPathIn,
  HEX64,
  listDiskBlobs,
  mentionedSince,
  scanMentions,
  sweepTmp,
} from './scan.ts';
import { sniff, SNIFF_BYTES } from './sniff.ts';
import type {
  AttachmentInfo,
  AttachmentRef,
  CleanupPreview,
  CleanupResult,
  Kind,
  VerifyFailure,
  VerifyReport,
  VerifyState,
} from './types.ts';

export const MiB = 1024 * 1024;
export const DEFAULT_MAX_BYTES = 200 * MiB;
/** The setting can never exceed this. */
export const HARD_MAX_BYTES = 1024 * MiB;
/** Clipboard-style in-memory adds. */
export const MAX_BYTES_INPUT = 32 * MiB;
const CHUNK = MiB;
/** Free space that must remain after a copy. */
const FREE_MARGIN = 64 * MiB;
const NO_SPACE = 'Not enough disk space to store this file. Free some space and try again.';

export interface AttachmentsOptions {
  /** Blob directory. Default: `attachments` next to the database. */
  root?: string;
  fs?: AttachFs;
  /** Read on every add so a changed setting applies at once. Default 200 MiB; clamped to 1 GiB. */
  maxBytes?: () => number;
  /** null disables PDF extraction (text stays 'pending'). Default: a forked child process. */
  pdf?: PdfTextExtractor | null;
  /** Copy chunk size (tests lower it to count writes). */
  chunkSize?: number;
}

/** What the desktop stage needs to serve a blob: verified bytes plus metadata. */
export interface VerifiedBlob {
  sha256: string;
  size: number;
  mime: string;
  kind: Kind;
  /** For Reveal in Finder and Save copy only. Never hand it to the renderer. */
  path: string;
  /** Bytes [start, end] inclusive (the whole file when omitted), read from the SAME file handle that was verified. */
  stream(range?: { start: number; end: number }): Readable;
  /** Release the handle. Idempotent. Call when the response ends or is aborted. */
  close(): void;
}

/** error.cause of a `corrupt` result from openVerified/check (RPC strips causes; desktop reads it). */
export interface AttachmentFault {
  attachmentState: 'missing' | 'corrupt';
  sha256: string;
}

const noteIdSchema = z.string().min(1).max(64);
const pathSchema = z.string().min(1).max(4096);
const confirmSchema = z.object({ confirmed: z.literal(true) }).strict();
const shasSchema = z.array(z.string().regex(HEX64)).max(10_000);

interface RefRow {
  refId: string;
  noteId: string;
  sha256: string;
  name: string;
  size: number;
  mime: string;
  kind: Kind;
  textState: AttachmentRef['textState'];
  verifyState: VerifyState;
  createdAt: number;
}
const REF_SQL = `SELECT na.id AS refId, na.note_id AS noteId, na.sha256 AS sha256, na.name AS name, a.size AS size,
  a.mime AS mime, a.kind AS kind, a.text_state AS textState, a.verify_state AS verifyState, na.created_at AS createdAt
  FROM note_attachments na JOIN attachments a ON a.sha256 = na.sha256`;
const toRef = (r: RefRow): AttachmentRef => ({
  ...r,
  url: attachmentUrl(r.sha256),
  markdown: markdownFor(r.name, r.sha256, r.kind),
});

const errCode = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : '';
};
const ioFail = (e: unknown, what = 'The file could not be stored'): Result<never> =>
  errCode(e) === 'ENOSPC' || errCode(e) === 'EDQUOT'
    ? err('io', NO_SPACE, e)
    : err('io', `${what} (${errCode(e) || 'I/O error'}).`, e); // never the OS message: it carries the path
const tooBig = (limit: number): Result<never> =>
  err('validation', `This file is larger than the limit of ${Math.round(limit / MiB)} MB.`);

interface Ingested {
  tmp: string;
  sha256: string;
  size: number;
  head: Uint8Array;
}
interface Source {
  size?: number;
  read(buf: Uint8Array, len: number): number;
  close(): void;
}

export function createAttachmentsApi(store: Store, opts: AttachmentsOptions = {}) {
  const db: Db = store.db;
  const fs = opts.fs ?? nodeAttachFs;
  const root = opts.root ?? join(dirname(store.path), 'attachments');
  const chunk = opts.chunkSize ?? CHUNK;
  const pdf: PdfTextExtractor | null =
    opts.pdf === undefined ? createForkExtractor() : opts.pdf;
  const ulid = createUlid(() => store.clock.now());
  const locks = createKeyedLock();
  const jobs = createJobMutex();
  /** sha -> "dev:ino:size:mtime:ctime" of the file that last passed hash verification. */
  const verified = new Map<string, string>();
  const hashing = new Map<string, Promise<string>>();
  const blobPath = (sha: string): string => blobPathIn(root, sha);

  sweepTmp(fs, root); // leftovers of an add that was interrupted by a crash

  const maxBytes = (): number => {
    const n = opts.maxBytes?.();
    return Math.min(
      HARD_MAX_BYTES,
      typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MAX_BYTES,
    );
  };

  // ---- hashing and verification ---------------------------------------------------------------
  async function hashFd(fd: number): Promise<string> {
    const h = createHash('sha256');
    const buf = new Uint8Array(chunk);
    let pos = 0;
    for (;;) {
      const n = fs.read(fd, buf, buf.length, pos);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
      pos += n;
      await yieldTick();
    }
    return h.digest('hex');
  }
  /** One hash per (sha, file identity) at a time: parallel Range requests share it. */
  function hashShared(sha: string, key: string, fd: number): Promise<string> {
    const k = `${sha}|${key}`;
    let p = hashing.get(k);
    if (!p) {
      p = hashFd(fd).finally(() => hashing.delete(k));
      hashing.set(k, p);
    }
    return p;
  }

  const damagedMessage = (sha: string, state: 'missing' | 'corrupt', noteId?: string): string => {
    const rows = db
      .prepare(
        `SELECT na.name AS name, n.title AS title FROM note_attachments na JOIN notes n ON n.id = na.note_id
         WHERE na.sha256 = ? ORDER BY (na.note_id = ?) DESC, na.created_at, na.id LIMIT 4`,
      )
      .all(sha, noteId ?? '') as { name: string; title: string }[];
    const first = rows[0];
    const where = first
      ? `Attachment "${first.name}" in note "${(first.title || 'Untitled').slice(0, 80)}"`
      : `Attachment ${sha.slice(0, 8)}`;
    const more = rows.length > 1 ? ` (and ${rows.length - 1} more)` : '';
    return `${where}${more} ${state === 'missing' ? 'is missing' : 'is damaged'}. Restore it from a backup.`;
  };

  /** verify_state is a status like a notice: no change-log row. Failures are ignored (best effort). */
  const markState = (sha: string, state: VerifyState): void => {
    store.mutate({}, (tx) => {
      tx.db
        .prepare(
          'UPDATE attachments SET verify_state = ?, verified_at = ? WHERE sha256 = ? AND verify_state IS NOT ?',
        )
        .run(state, tx.now, sha, state);
      return ok(undefined);
    });
  };

  const fault = (sha: string, state: 'missing' | 'corrupt', noteId?: string): Result<never> => {
    verified.delete(sha);
    markState(sha, state);
    const cause: AttachmentFault = { attachmentState: state, sha256: sha };
    return err('corrupt', damagedMessage(sha, state, noteId), cause);
  };

  /** Opens the blob, verifies its hash (cached per file identity), and serves from that same handle. */
  async function openVerified(
    sha: string,
    o: { noteId?: string } = {},
  ): Promise<Result<VerifiedBlob>> {
    if (!HEX64.test(sha)) return err('validation', 'Invalid attachment id.');
    const row = db
      .prepare('SELECT size, mime, kind, verify_state AS vs FROM attachments WHERE sha256 = ?')
      .get(sha) as { size: number; mime: string; kind: Kind; vs: VerifyState } | undefined;
    if (!row) return err('not_found', 'This attachment is not in this workspace.');
    const path = blobPath(sha);
    let fd: number;
    try {
      fd = fs.openRead(path);
    } catch (e) {
      return errCode(e) === 'ENOENT' ? fault(sha, 'missing', o.noteId) : ioFail(e, 'Cannot read the attachment');
    }
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      try {
        fs.close(fd);
      } catch {
        /* already gone */
      }
    };
    try {
      const st = fs.fstat(fd);
      if (!st.isFile || st.size !== row.size) {
        close();
        return fault(sha, 'corrupt', o.noteId);
      }
      const key = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
      if (verified.get(sha) !== key) {
        const digest = await hashShared(sha, key, fd);
        if (digest !== sha) {
          close();
          return fault(sha, 'corrupt', o.noteId);
        }
        verified.set(sha, key);
      }
      if (row.vs !== 'ok') markState(sha, 'ok');
    } catch (e) {
      close();
      return ioFail(e, 'Cannot read the attachment');
    }
    return ok({
      sha256: sha,
      size: row.size,
      mime: row.mime,
      kind: row.kind,
      path,
      close,
      stream(range) {
        if (closed || row.size === 0) return Readable.from([]);
        const start = range?.start ?? 0;
        const end = Math.min(range?.end ?? row.size - 1, row.size - 1);
        if (start > end) return Readable.from([]);
        return createReadStream(path, { fd, start, end, autoClose: false, highWaterMark: 256 * 1024 });
      },
    });
  }

  // ---- adding -----------------------------------------------------------------------------------
  const discard = (fd: number | undefined, tmp: string): void => {
    if (fd !== undefined) {
      try {
        fs.close(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.unlink(tmp);
    } catch {
      /* never created, or already gone */
    }
  };

  /** Streams `src` into a temp file, hashing while writing. A failure leaves no temp file. */
  async function ingest(src: Source, limit: number): Promise<Result<Ingested>> {
    let fd: number | undefined;
    const tmp = join(root, '.tmp', ulid());
    let done = false;
    try {
      if (src.size !== undefined && src.size > limit) return tooBig(limit);
      fs.mkdirp(join(root, '.tmp'));
      if (src.size !== undefined) {
        const free = fs.freeBytes(root);
        if (free !== undefined && free < src.size + FREE_MARGIN) return err('io', NO_SPACE);
      }
      fd = fs.openNew(tmp);
      const h = createHash('sha256');
      const buf = new Uint8Array(chunk);
      const head = new Uint8Array(SNIFF_BYTES);
      let headLen = 0;
      let total = 0;
      for (;;) {
        const n = src.read(buf, buf.length);
        if (n === 0) break;
        total += n;
        if (total > limit) return tooBig(limit);
        h.update(buf.subarray(0, n));
        fs.write(fd, buf, n);
        if (headLen < SNIFF_BYTES) {
          const k = Math.min(n, SNIFF_BYTES - headLen);
          head.set(buf.subarray(0, k), headLen);
          headLen += k;
        }
        await yieldTick();
      }
      fs.fsync(fd);
      fs.close(fd);
      fd = undefined;
      done = true;
      return ok({ tmp, sha256: h.digest('hex'), size: total, head: head.subarray(0, headLen) });
    } catch (e) {
      return ioFail(e);
    } finally {
      src.close();
      if (!done) discard(fd, tmp);
    }
  }

  /** Under the per-sha lock: put the verified temp file in place, then record it. */
  function place(
    ctx: Ctx,
    noteId: string,
    displayName: string,
    ing: Ingested,
  ): Promise<Result<AttachmentRef>> {
    const sha = ing.sha256;
    const dest = blobPath(sha);
    const sn = sniff(ing.head, displayName);
    return locks.run(sha, async (): Promise<Result<AttachmentRef>> => {
      try {
        fs.mkdirp(dirname(dest));
        // Atomic replace: identical bytes dedupe to one file, and a damaged copy of the same content heals.
        fs.rename(ing.tmp, dest);
        fs.fsyncDir(dirname(dest));
        fs.fsyncDir(dirname(dirname(dest)));
      } catch (e) {
        discard(undefined, ing.tmp);
        return ioFail(e);
      }
      const r = store.mutate(ctx, (tx) => {
        const note = tx.db
          .prepare('SELECT folder_id, trashed_at FROM notes WHERE id = ?')
          .get(noteId) as { folder_id: string | null; trashed_at: number | null } | undefined;
        if (!note) return err('not_found', 'note not found');
        if (noteIsTrashed(tx.db, note)) return err('trashed', 'note is in the trash');
        const have = tx.db
          .prepare('SELECT kind, text_state AS ts FROM attachments WHERE sha256 = ?')
          .get(sha) as { kind: Kind; ts: string } | undefined;
        if (!have) {
          tx.db
            .prepare(
              `INSERT INTO attachments(sha256, size, mime, kind, text, text_state, verify_state, verified_at, created_at)
               VALUES (?, ?, ?, ?, '', ?, 'ok', ?, ?)`,
            )
            .run(sha, ing.size, sn.mime, sn.kind, sn.kind === 'pdf' ? 'pending' : 'none', tx.now, tx.now);
        } else {
          // Stricter wins: a name that proves "script" upgrades the blob, nothing ever downgrades it.
          if (sn.kind === 'executable' && have.kind !== 'executable')
            tx.db
              .prepare("UPDATE attachments SET kind = 'executable', mime = ? WHERE sha256 = ?")
              .run(sn.mime, sha);
          tx.db
            .prepare("UPDATE attachments SET verify_state = 'ok', verified_at = ? WHERE sha256 = ?")
            .run(tx.now, sha);
          if (have.kind === 'pdf' && (have.ts === 'none' || have.ts === 'failed'))
            tx.db.prepare("UPDATE attachments SET text_state = 'pending' WHERE sha256 = ?").run(sha);
        }
        const existing = tx.db
          .prepare(`${REF_SQL} WHERE na.note_id = ? AND na.sha256 = ?`)
          .get(noteId, sha) as RefRow | undefined;
        if (existing) return ok(existing);
        const refId = tx.ulid();
        tx.db
          .prepare(
            'INSERT INTO note_attachments(id, note_id, sha256, name, created_at, device_id) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(refId, noteId, sha, displayName, tx.now, tx.deviceId);
        const l = tx.log({
          entity: 'attachment_ref',
          entityId: refId,
          op: 'create',
          contentHash: sha,
          fields: { noteId, sha256: sha, name: displayName, size: ing.size, mime: sn.mime },
        });
        if (!l.ok) return l;
        return ok(tx.db.prepare(`${REF_SQL} WHERE na.id = ?`).get(refId) as RefRow);
      });
      if (r.ok) {
        // The temp file was renamed over the destination and is verified by construction.
        return ok(toRef(r.value));
      }
      return r;
    });
  }

  /** Fast refusal before copying hundreds of MB for a note that cannot take them. */
  const noteCheck = (noteId: string): Result<void> =>
    safe(() => {
      const note = db.prepare('SELECT folder_id, trashed_at FROM notes WHERE id = ?').get(noteId) as
        | { folder_id: string | null; trashed_at: number | null }
        | undefined;
      if (!note) return err('not_found', 'note not found');
      return noteIsTrashed(db, note) ? err('trashed', 'note is in the trash') : ok(undefined);
    });

  async function add(
    ctx: Ctx,
    noteIdRaw: unknown,
    open: () => Result<Source>,
    name: string,
    cap: number,
  ): Promise<Result<AttachmentRef>> {
    const n = parse(noteIdSchema, noteIdRaw);
    if (!n.ok) return n;
    const c = noteCheck(n.value);
    if (!c.ok) return c;
    const src = open();
    if (!src.ok) return src;
    const ing = await ingest(src.value, Math.min(maxBytes(), cap));
    if (!ing.ok) return ing;
    return place(ctx, n.value, sanitizeName(name), ing.value);
  }

  // ---- text extraction --------------------------------------------------------------------------
  let extracting: Promise<{ processed: number; noteIds: string[] }> | undefined;
  async function extractAll(): Promise<{ processed: number; noteIds: string[] }> {
    const noteIds = new Set<string>();
    let processed = 0;
    if (!pdf) return { processed, noteIds: [] };
    const seen = new Set<string>();
    for (;;) {
      const row = db
        .prepare(
          "SELECT sha256 FROM attachments WHERE text_state = 'pending' AND kind = 'pdf' ORDER BY created_at, sha256 LIMIT 20",
        )
        .all() as { sha256: string }[];
      const next = row.find((r) => !seen.has(r.sha256));
      if (!next) break;
      seen.add(next.sha256);
      let text = '';
      let state: 'done' | 'failed' = 'failed';
      const v = await openVerified(next.sha256);
      if (v.ok) {
        const path = v.value.path;
        v.value.close();
        try {
          text = (await pdf.extract(path)).text.replaceAll('\u0000', '');
          state = 'done';
        } catch {
          text = '';
        }
      }
      const r = store.mutate({}, (tx) => {
        const used = tx.db
          .prepare('SELECT DISTINCT note_id AS id FROM note_attachments WHERE sha256 = ?')
          .all(next.sha256) as { id: string }[];
        if (used.length === 0) {
          // Purged while extracting: store nothing (decision M10).
          tx.db
            .prepare("UPDATE attachments SET text = '', text_state = 'none' WHERE sha256 = ? AND text_state = 'pending'")
            .run(next.sha256);
          return ok([] as string[]);
        }
        tx.db
          .prepare("UPDATE attachments SET text = ?, text_state = ? WHERE sha256 = ? AND text_state = 'pending'")
          .run(text, state, next.sha256);
        return ok(used.map((u) => u.id));
      });
      if (r.ok) {
        processed++;
        for (const id of r.value) noteIds.add(id);
      }
    }
    return { processed, noteIds: [...noteIds] };
  }

  // ---- the public API ---------------------------------------------------------------------------
  const api = {
    /**
     * Adds a file by PATH. The path must come from the main process (file dialog or a token it issued),
     * never from the renderer. Streams, hashes while writing, fsyncs, renames; dedupes by content.
     */
    addFromPath(ctx: Ctx, noteId: string, path: string, name?: string): Promise<Result<AttachmentRef>> {
      const p = parse(pathSchema, path);
      if (!p.ok) return Promise.resolve(p);
      return add(
        ctx,
        noteId,
        () => {
          let fd: number;
          try {
            fd = fs.openRead(p.value);
          } catch (e) {
            return errCode(e) === 'ENOENT'
              ? err('not_found', 'The file could not be found.')
              : ioFail(e, 'The file could not be read');
          }
          try {
            const st = fs.fstat(fd);
            // FIFOs, sockets and devices would hang or never end.
            if (!st.isFile) {
              fs.close(fd);
              return err('validation', 'Only regular files can be attached.');
            }
            return ok<Source>({
              size: st.size,
              read: (buf, len) => fs.read(fd, buf, len),
              close: () => {
                try {
                  fs.close(fd);
                } catch {
                  /* ignore */
                }
              },
            });
          } catch (e) {
            try {
              fs.close(fd);
            } catch {
              /* ignore */
            }
            return ioFail(e, 'The file could not be read');
          }
        },
        name ?? basename(p.value),
        HARD_MAX_BYTES,
      );
    },

    /** Adds in-memory bytes (clipboard image). At most 32 MiB. */
    addFromBytes(ctx: Ctx, noteId: string, bytes: Uint8Array, name: string): Promise<Result<AttachmentRef>> {
      return add(
        ctx,
        noteId,
        () => {
          let pos = 0;
          return ok<Source>({
            size: bytes.length,
            read(buf, len) {
              const n = Math.min(len, bytes.length - pos);
              buf.set(bytes.subarray(pos, pos + n));
              pos += n;
              return n;
            },
            close() {},
          });
        },
        name,
        MAX_BYTES_INPUT,
      );
    },

    listForNote(noteId: string): Result<AttachmentRef[]> {
      const n = parse(noteIdSchema, noteId);
      if (!n.ok) return n;
      return safe(() => {
        if (!db.prepare('SELECT 1 AS x FROM notes WHERE id = ?').get(n.value))
          return err('not_found', 'note not found');
        const rows = db
          .prepare(`${REF_SQL} WHERE na.note_id = ? ORDER BY na.created_at, na.id`)
          .all(n.value) as RefRow[];
        return ok(rows.map(toRef));
      });
    },

    /** Removes the link from the note. The file stays until Cleanup. Returns the note id for events. */
    removeRef(ctx: Ctx, refId: string): Result<{ noteId: string }> {
      const id = parse(noteIdSchema, refId);
      if (!id.ok) return id;
      return store.mutate(ctx, (tx) => {
        const r = tx.db
          .prepare('SELECT note_id AS noteId, sha256 FROM note_attachments WHERE id = ?')
          .get(id.value) as { noteId: string; sha256: string } | undefined;
        if (!r) return err('not_found', 'attachment not found');
        tx.db.prepare('DELETE FROM note_attachments WHERE id = ?').run(id.value);
        clearOrphanText(tx.db, [r.sha256]);
        redactFields(tx.db, [id.value]);
        const l = tx.log({ entity: 'attachment_ref', entityId: id.value, op: 'purge' });
        return l.ok ? ok({ noteId: r.noteId }) : l;
      });
    },

    /** Metadata of one blob; `verify` hashes the file now and reports a damaged or missing one (AT-2). */
    async info(
      sha: string,
      o: { noteId?: string; verify?: boolean } = {},
    ): Promise<Result<AttachmentInfo>> {
      if (!HEX64.test(sha)) return err('validation', 'Invalid attachment id.');
      const row = db
        .prepare(
          'SELECT size, mime, kind, text_state AS textState, verify_state AS verifyState, created_at AS createdAt FROM attachments WHERE sha256 = ?',
        )
        .get(sha) as Omit<AttachmentInfo, 'sha256' | 'refs'> | undefined;
      if (!row) return err('not_found', 'This attachment is not in this workspace.');
      let state: VerifyState | undefined;
      let message: string | undefined;
      if (o.verify) {
        const v = await openVerified(sha, { noteId: o.noteId });
        if (v.ok) {
          v.value.close();
          state = 'ok';
        } else if (v.error.code === 'corrupt') {
          state = (v.error.cause as AttachmentFault).attachmentState;
          message = v.error.message;
        } else return v;
      }
      const refs = db
        .prepare(
          `SELECT na.id AS refId, na.note_id AS noteId, n.title AS noteTitle, na.name AS name
           FROM note_attachments na JOIN notes n ON n.id = na.note_id WHERE na.sha256 = ? ORDER BY na.created_at, na.id LIMIT 20`,
        )
        .all(sha) as AttachmentInfo['refs'];
      const cur = db.prepare('SELECT verify_state AS v FROM attachments WHERE sha256 = ?').get(sha) as { v: VerifyState };
      const out: AttachmentInfo = { sha256: sha, ...row, verifyState: cur.v, refs };
      if (state) out.state = state;
      if (message) out.message = message;
      return ok(out);
    },

    openVerified,

    /** Like info(verify) but only the verdict; a blob this workspace does not know reports 'missing'. */
    async check(
      sha: string,
      noteId?: string,
    ): Promise<Result<{ state: VerifyState; message?: string }>> {
      const v = await openVerified(sha, { noteId });
      if (v.ok) {
        v.value.close();
        return ok({ state: 'ok' as VerifyState });
      }
      if (v.error.code === 'corrupt')
        return ok({ state: (v.error.cause as AttachmentFault).attachmentState, message: v.error.message });
      if (v.error.code === 'not_found') return ok({ state: 'missing' as VerifyState, message: v.error.message });
      return v;
    },

    /**
     * Unused attachments: no reference row (trashed notes count as references) and the hash string
     * appears in no note, version or draft body. Also lists files on disk that no row describes.
     */
    cleanupPreview(): Promise<Result<CleanupPreview>> {
      return jobs.run(async (): Promise<Result<CleanupPreview>> => {
        try {
          const mentioned = await scanMentions(db);
          const referenced = new Set(
            (db.prepare('SELECT DISTINCT sha256 FROM note_attachments').all() as { sha256: string }[]).map((r) => r.sha256),
          );
          const rows = db.prepare('SELECT sha256, size, mime, kind FROM attachments').all() as {
            sha256: string;
            size: number;
            mime: string;
            kind: Kind;
          }[];
          const items: CleanupPreview['items'] = [];
          const known = new Set<string>();
          for (const r of rows) {
            known.add(r.sha256);
            if (!referenced.has(r.sha256) && !mentioned.has(r.sha256))
              items.push({ sha256: r.sha256, size: r.size, mime: r.mime, kind: r.kind, untracked: false });
          }
          for (const f of listDiskBlobs(fs, root)) {
            if (known.has(f.sha256) || mentioned.has(f.sha256)) continue;
            let size = 0;
            try {
              size = fs.stat(f.path).size;
            } catch {
              continue;
            }
            items.push({ sha256: f.sha256, size, mime: 'application/octet-stream', kind: 'unknown', untracked: true });
          }
          items.sort((a, b) => b.size - a.size || (a.sha256 < b.sha256 ? -1 : 1));
          return ok({ items, totalBytes: items.reduce((s, i) => s + i.size, 0) });
        } catch (e) {
          return err('internal', e instanceof Error ? e.message : 'cleanup preview failed', e);
        }
      });
    },

    /**
     * Deletes the chosen unused attachments (explicit user action, after cleanupPreview). Unlink only.
     * Each file is re-validated under its per-sha lock inside the delete transaction; anything in use
     * now is skipped, never deleted.
     */
    cleanupRun(shas: unknown, opts: unknown): Promise<Result<CleanupResult>> {
      const c = parse(confirmSchema, opts);
      if (!c.ok) return Promise.resolve(c);
      const list = parse(shasSchema, shas);
      if (!list.ok) return Promise.resolve(list);
      const wanted = [...new Set(list.value)];
      return jobs.run(async (): Promise<Result<CleanupResult>> => {
        try {
          const since = store.clock.now();
          const mentioned = await scanMentions(db);
          let deleted = 0;
          let bytes = 0;
          const skipped: string[] = [];
          for (const sha of wanted) {
            if (mentioned.has(sha)) {
              skipped.push(sha);
              continue;
            }
            await locks.run(sha, () => {
              const path = blobPath(sha);
              const tx = store.mutate<{ live: boolean; size: number | undefined }>({}, (t) => {
                const ref = t.db.prepare('SELECT 1 AS x FROM note_attachments WHERE sha256 = ? LIMIT 1').get(sha);
                if (ref || mentionedSince(t.db, since, sha)) return ok({ live: true, size: undefined });
                const row = t.db.prepare('SELECT size FROM attachments WHERE sha256 = ?').get(sha) as
                  | { size: number }
                  | undefined;
                if (row) t.db.prepare('DELETE FROM attachments WHERE sha256 = ?').run(sha);
                return ok({ live: false, size: row?.size });
              });
              if (!tx.ok || tx.value.live) {
                skipped.push(sha);
                return;
              }
              verified.delete(sha);
              try {
                let size = tx.value.size;
                if (fs.exists(path)) {
                  size = size ?? fs.stat(path).size;
                  fs.unlink(path);
                  fs.fsyncDir(dirname(path));
                } else if (size === undefined) {
                  skipped.push(sha); // neither a row nor a file: nothing was there
                  return;
                }
                deleted++;
                bytes += size ?? 0;
              } catch {
                skipped.push(sha); // the row is gone, the file remains: Cleanup lists it as untracked
              }
            });
            await yieldTick();
          }
          afterPurge(db); // text left the table: merge the index and fold the WAL
          return ok({ deleted, bytes, skipped });
        } catch (e) {
          return err('internal', e instanceof Error ? e.message : 'cleanup failed', e);
        }
      });
    },

    /** Hashes every attachment (AT-2). Updates verify_state; lists files no row describes. */
    verifyAll(): Promise<Result<VerifyReport>> {
      return jobs.run(async (): Promise<Result<VerifyReport>> => {
        try {
          const rows = db.prepare('SELECT sha256, size, verify_state AS vs FROM attachments ORDER BY sha256').all() as {
            sha256: string;
            size: number;
            vs: VerifyState;
          }[];
          const missing: VerifyFailure[] = [];
          const corrupt: VerifyFailure[] = [];
          let good = 0;
          const failure = (sha: string, size: number): VerifyFailure => ({
            sha256: sha,
            size,
            notes: (
              db
                .prepare(
                  `SELECT na.note_id AS noteId, n.title AS title, na.name AS name FROM note_attachments na
                   JOIN notes n ON n.id = na.note_id WHERE na.sha256 = ? ORDER BY na.created_at, na.id LIMIT 5`,
                )
                .all(sha) as VerifyFailure['notes']
            ),
          });
          for (const r of rows) {
            let state: VerifyState = 'ok';
            let fd: number | undefined;
            try {
              fd = fs.openRead(blobPath(r.sha256));
              const st = fs.fstat(fd);
              if (!st.isFile || st.size !== r.size) state = 'corrupt';
              else if ((await hashFd(fd)) !== r.sha256) state = 'corrupt';
              else verified.set(r.sha256, `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`);
            } catch (e) {
              state = errCode(e) === 'ENOENT' ? 'missing' : 'corrupt';
            } finally {
              if (fd !== undefined) {
                try {
                  fs.close(fd);
                } catch {
                  /* ignore */
                }
              }
            }
            if (state === 'ok') good++;
            else {
              verified.delete(r.sha256);
              (state === 'missing' ? missing : corrupt).push(failure(r.sha256, r.size));
            }
            if (state !== r.vs) markState(r.sha256, state);
            await yieldTick();
          }
          const known = new Set(rows.map((r) => r.sha256));
          const untracked = listDiskBlobs(fs, root)
            .map((f) => f.sha256)
            .filter((s) => !known.has(s))
            .sort();
          return ok({ checked: rows.length, ok: good, missing, corrupt, untracked });
        } catch (e) {
          return err('internal', e instanceof Error ? e.message : 'verify failed', e);
        }
      });
    },

    /** Every blob with its size and its path inside the attachments directory (backup and export). */
    manifest(): Result<{ sha256: string; size: number; mime: string; relPath: string }[]> {
      return safe(() => {
        const rows = db.prepare('SELECT sha256, size, mime FROM attachments ORDER BY sha256').all() as {
          sha256: string;
          size: number;
          mime: string;
        }[];
        return ok(rows.map((r) => ({ ...r, relPath: `${r.sha256.slice(0, 2)}/${r.sha256.slice(2, 4)}/${r.sha256}` })));
      });
    },

    /** Extracts text of PDFs still 'pending'. One run at a time; failures only mark the file 'failed' (AT-7). */
    extractPending(): Promise<{ processed: number; noteIds: string[] }> {
      extracting ??= extractAll()
        .catch(() => ({ processed: 0, noteIds: [] as string[] }))
        .finally(() => {
          extracting = undefined;
        });
      return extracting;
    },

    /** The attachments directory (desktop: a protocol handler never needs it; Reveal uses openVerified().path). */
    get root(): string {
      return root;
    },
    maxBytes,
    /** Kills a running extractor (workspace closing). A job still running fails cleanly on the closed database. */
    dispose(): void {
      pdf?.dispose();
    },
    /** Resolves when no cleanup or verify job is running (graceful quit drains this first). */
    idle: (): Promise<void> => jobs.run(() => undefined),
    /** Test seam: the per-sha lock and the job mutex. */
    _locks: locks,
    _jobs: jobs,
    _hashing: hashing as ReadonlyMap<string, unknown>,
  };
  return api;
}
export type AttachmentsApi = ReturnType<typeof createAttachmentsApi>;
