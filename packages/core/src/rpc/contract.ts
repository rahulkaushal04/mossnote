/**
 * The frozen renderer <-> main RPC contract (app-shell S1). Imports only zod, so the UI can import
 * it (types and the pure schemas) without pulling in Node or SQLite. Args are zod strict schemas;
 * replies are TS types in `Replies`. Replies are structured-clone safe and never carry `cause`.
 */
import { z } from 'zod';
import type {
  AttachmentInfo,
  AttachmentRef,
  CleanupPreview,
  CleanupResult,
  VerifyReport,
} from '../attachments/types.ts';
import { searchParamsSchema, specSchema } from '../search/params.ts';
import type { SearchPage } from '../search/params.ts';
import type { IndexStatus } from '../search/rebuild.ts';
import type { SavedSearch } from '../search/saved.ts';

export const MAX_BODY = 10_000_000;
export const MAX_CAPTURE = 1_000_000;
export const MAX_TITLE = 200;

const id = z.string().min(1).max(64);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const none = z.object({}).strict();
const base = z.object({ rev: z.number().int().min(0), contentHash: hash }).strict();

const MIB = 1024 * 1024;
export const prefsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    navWidth: z.number().int().min(120).max(800),
    listWidth: z.number().int().min(120).max(800),
    navCollapsed: z.boolean(),
    /** Largest attachment in bytes: 1 MB .. 1 GB hard cap (AT-3). */
    attachmentMaxBytes: z
      .number()
      .int()
      .min(MIB)
      .max(1024 * MIB),
  })
  .strict();
export type Prefs = z.infer<typeof prefsSchema>;
export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  navWidth: 240,
  listWidth: 320,
  navCollapsed: false,
  attachmentMaxBytes: 200 * MIB,
};

export const MAX_BULK = 10_000;
const bulkIds = z.array(id).min(1).max(MAX_BULK);
export const bulkMoveIn = z
  .object({
    items: z.array(z.object({ id, folderId: id.nullable() }).strict()).min(1).max(MAX_BULK),
    /** Set by the Undo of a move: items that changed meanwhile are skipped (and reported) instead of failing. */
    undo: z.literal(true).optional(),
  })
  .strict();
export const bulkTagIn = z
  .object({ ids: bulkIds, tagId: id, on: z.boolean(), undo: z.literal(true).optional() })
  .strict();
export const bulkTrashIn = z.object({ ids: bulkIds }).strict();
export const bulkUntrashIn = z.object({ batchIds: bulkIds }).strict();

const passphrase = z.string().min(8).max(1024);
const backupId = z.string().min(1).max(200);
export const scheduleSchema = z
  .object({
    auto: z.boolean(),
    intervalHours: z.number().int().min(1).max(168),
    keep: z.number().int().min(1).max(100),
  })
  .strict();

export const methods = {
  'app.status': { args: none },
  'app.flushed': { args: z.object({ token: z.string().min(1).max(128) }).strict() },
  'app.quit': { args: none },
  'app.openCapture': { args: none },

  'notes.list': {
    args: z
      .object({
        folderId: id.nullable().optional(),
        trashed: z.boolean().optional(),
        favorite: z.boolean().optional(),
        tagId: id.optional(),
        limit: z.number().int().min(1).max(100_000).optional(),
        cursor: z.object({ updatedAt: z.number().int(), id }).strict().optional(),
      })
      .strict(),
  },
  'notes.get': { args: z.object({ id }).strict() },
  'notes.create': {
    args: z
      .object({ folderId: id.nullable().optional(), body: z.string().max(MAX_BODY).optional() })
      .strict(),
  },
  'notes.save': {
    args: z.object({ id, body: z.string().max(MAX_BODY), expectedContentHash: hash }).strict(),
  },
  'notes.move': { args: z.object({ id, folderId: id.nullable() }).strict() },
  'notes.setFavorite': { args: z.object({ id, favorite: z.boolean() }).strict() },
  'notes.trash': { args: z.object({ id }).strict() },

  'folders.list': { args: none },
  'folders.create': {
    args: z.object({ name: z.string().max(255), parentId: id.nullable().optional() }).strict(),
  },
  'folders.rename': { args: z.object({ id, name: z.string().max(255) }).strict() },
  'folders.move': { args: z.object({ id, parentId: id.nullable() }).strict() },
  'folders.trash': { args: z.object({ id }).strict() },

  'tags.list': { args: none },
  'tags.create': { args: z.object({ name: z.string().max(100) }).strict() },
  'tags.rename': {
    args: z
      .object({ id, name: z.string().max(100), confirmMerge: z.literal(true).optional() })
      .strict(),
  },
  'tags.forNote': { args: z.object({ noteId: id }).strict() },
  'tags.tagNote': { args: z.object({ noteId: id, tagId: id }).strict() },
  'tags.untagNote': { args: z.object({ noteId: id, tagId: id }).strict() },

  'trash.list': { args: none },
  'trash.restore': { args: z.object({ batchId: id }).strict() },
  'trash.purge': { args: z.object({ batchId: id, confirmed: z.literal(true) }).strict() },

  'drafts.write': {
    args: z.object({ noteId: id, text: z.string().max(MAX_BODY), base }).strict(),
  },
  'drafts.flush': { args: z.object({ noteId: id.optional() }).strict() },
  'drafts.recover': { args: z.object({ noteId: id.optional() }).strict() },
  'drafts.discard': {
    args: z.object({ noteId: id, upToSeq: z.number().int().min(0) }).strict(),
  },

  'prefs.get': { args: none },
  'prefs.set': { args: prefsSchema.partial().strict() },

  // Search: params are the core schema (query <= 1000, limit 1..100, <= 20 ids, strict, bounded cursor).
  'search.run': { args: searchParamsSchema },
  'search.status': { args: none },
  'search.verify': { args: none },
  // Main window only (not in CAPTURE_METHODS): marks the index dirty and starts the rebuild.
  'search.rebuild': { args: none },
  'search.saved.list': { args: none },
  'search.saved.create': {
    args: z.object({ name: z.string().max(200), spec: specSchema }).strict(),
  },
  'search.saved.rename': { args: z.object({ id, name: z.string().max(200) }).strict() },
  'search.saved.delete': { args: z.object({ id }).strict() },
  'search.saved.reset': { args: none },

  // Attachments. None of these is a capture method. There is no "open": nothing is ever launched (AT-4).
  // addPath takes an opaque token the MAIN process issued for a file the user picked or dropped;
  // the renderer never supplies a path and no method accepts bytes.
  'attachments.addPath': {
    args: z.object({ noteId: id, token: z.string().min(1).max(128) }).strict(),
  },
  'attachments.list': { args: z.object({ noteId: id }).strict() },
  'attachments.remove': { args: z.object({ refId: id }).strict() },
  'attachments.info': {
    args: z.object({ sha256: hash, noteId: id.optional(), verify: z.boolean().optional() }).strict(),
  },
  'attachments.cleanupPreview': { args: none },
  'attachments.cleanupRun': {
    args: z.object({ sha256s: z.array(hash).max(10_000), confirmed: z.literal(true) }).strict(),
  },
  'attachments.verifyAll': { args: none },

  // Portability. None is a capture method. Renderer args never carry a path: export/import folders and the
  // backup file come from main-process dialogs (DispatcherOptions.pick*), restores from library ids.
  'portability.status': { args: none },
  'portability.setSchedule': { args: scheduleSchema },
  'portability.exportStart': {
    args: z
      .object({
        scope: z.union([
          z.object({ kind: z.literal('all') }).strict(),
          z.object({ kind: z.literal('notes'), ids: z.array(id).min(1).max(100_000) }).strict(),
        ]),
      })
      .strict(),
  },
  'portability.importStart': { args: none },
  'portability.backupNow': {
    args: z
      .object({ to: z.enum(['library', 'file']), passphrase: passphrase.optional() })
      .strict()
      .refine((a) => a.passphrase === undefined || a.to === 'file', {
        message: 'a passphrase is only used with Save backup as',
      }),
  },
  'portability.backupList': { args: none },
  'portability.backupVerify': {
    args: z.object({ id: backupId, passphrase: z.string().min(1).max(1024).optional() }).strict(),
  },
  'portability.restoreStart': {
    args: z
      .object({
        source: z.union([
          z.object({ id: backupId }).strict(),
          z.object({ file: z.literal(true) }).strict(),
        ]),
        passphrase: z.string().min(1).max(1024).optional(),
      })
      .strict(),
  },
  'bulk.move': { args: bulkMoveIn },
  'bulk.tag': { args: bulkTagIn },
  'bulk.trash': { args: bulkTrashIn },
  'bulk.untrash': { args: bulkUntrashIn },
  'bulk.export': { args: z.object({ ids: z.array(id).min(1).max(100_000) }).strict() },

  'capture.save': { args: z.object({ text: z.string().min(1).max(MAX_CAPTURE) }).strict() },
} as const;

export type MethodName = keyof typeof methods;
export type Args<M extends MethodName> = z.input<(typeof methods)[M]['args']>;

/** A capture window may call only these (enforced by desktop's ipc glue). */
// app.flushed lets the capture window acknowledge the quit flush (its text is saved first); the token is unguessable.
export const CAPTURE_METHODS: readonly MethodName[] = [
  'capture.save',
  'app.status',
  'prefs.get',
  'app.flushed',
];

export type ErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'trashed'
  | 'io'
  | 'corrupt'
  | 'unavailable'
  | 'internal';
/** Only these two fields ever cross the boundary. */
export interface RpcError {
  code: ErrorCode;
  message: string;
}
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError };

export interface NoteSummary {
  id: string;
  folderId: string | null;
  title: string;
  contentHash: string;
  rev: number;
  favorite: boolean;
  headVersionId: string | null;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
  trashedAt: number | null;
  trashed: boolean;
}
export interface Note extends NoteSummary {
  body: string;
}
export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
  trashedAt: number | null;
  trashed: boolean;
}
export interface Tag {
  id: string;
  name: string;
  nameKey: string;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
}
export type RenameTagResult =
  { kind: 'renamed'; tag: Tag } | { kind: 'needsMerge'; into: Tag } | { kind: 'merged'; tag: Tag };
export interface TrashItem {
  batchId: string;
  entity: 'note' | 'folder';
  id: string;
  label: string;
  trashedAt: number;
  expiresAt: number;
  noticeAt: number | null;
}
export interface RecoverableDraft {
  seq: number;
  noteId: string;
  body: string;
  savedAt: number;
  base: { rev: number; contentHash: string };
  baseChanged: boolean;
  matchesNote: boolean;
}
export interface SaveReply {
  rev: number;
  contentHash: string;
  title: string;
  updatedAt: number;
}
export interface AppStatus {
  state: 'ready' | 'error';
  code?: ErrorCode;
  message?: string;
  platform: string;
}

export type JobKind = 'export' | 'import' | 'backup' | 'restore';
export type JobStarted = { jobId: string } | { cancelled: true };
export interface ScheduleSettings {
  auto: boolean;
  intervalHours: number;
  keep: number;
}
export interface BackupSummary {
  /** The only handle the renderer holds for a backup in the library. */
  id: string;
  kind: 'auto' | 'manual' | 'pre-migration';
  createdAt: number;
  size: number;
  encrypted: boolean;
  /** Structure and trailer look right (cheap). Use backupVerify for the full hash check. */
  valid: boolean;
  /** false: listed for information only (pre-migration copies). */
  restorable: boolean;
  noteCount?: number;
  /** Attachments that were already damaged when this backup was written. */
  damaged?: number;
}
export interface ImportFileReport {
  rel: string;
  status: 'added' | 'skipped' | 'repaired';
  reason: string;
}
export type JobResult =
  | { kind: 'export'; folderName: string; notes: number; attachments: number; warnings: string[] }
  | {
      kind: 'import';
      added: number;
      skipped: number;
      repaired: number;
      folderName: string;
      files: ImportFileReport[];
      truncated: boolean;
      reportFile: string;
      resumed: boolean;
      stoppedEarly?: string;
    }
  | {
      kind: 'backup';
      id: string;
      encrypted: boolean;
      size: number;
      noteCount: number;
      attachments: number;
      /** > 0: the backup is incomplete (some attachment files were already damaged). */
      damaged: number;
      verified: true;
    }
  | {
      kind: 'restore';
      /** The restore is staged and verified; it is applied when the app restarts (desktop restarts it). */
      restartRequired: true;
      backupCreatedAt: string;
      noteCount: number;
      damaged: number;
    };
export interface PortabilityStatus {
  job?: { jobId: string; kind: JobKind; phase: string; done: number; total: number };
  lastJob?: { jobId: string; kind: JobKind; ok: boolean; error?: RpcError };
  schedule: ScheduleSettings;
  lastAutoBackupAt: number | null;
  libraryBytes: number;
  /** An interrupted import is waiting: the next importStart resumes it. */
  pendingImport: boolean;
  restorePending: boolean;
}

export interface Replies {
  'app.status': AppStatus;
  'app.flushed': void;
  'app.quit': void;
  'app.openCapture': void;
  'notes.list': NoteSummary[];
  'notes.get': Note;
  'notes.create': Note;
  'notes.save': SaveReply;
  'notes.move': NoteSummary;
  'notes.setFavorite': NoteSummary;
  'notes.trash': { batchId: string };
  'folders.list': Folder[];
  'folders.create': Folder;
  'folders.rename': Folder;
  'folders.move': Folder;
  'folders.trash': { batchId: string };
  'tags.list': Tag[];
  'tags.create': Tag;
  'tags.rename': RenameTagResult;
  'tags.forNote': Tag[];
  'tags.tagNote': void;
  'tags.untagNote': void;
  'trash.list': TrashItem[];
  'trash.restore': { entity: 'note' | 'folder'; id: string };
  'trash.purge': { purged: number };
  'drafts.write': void;
  'drafts.flush': Record<string, number>;
  'drafts.recover': RecoverableDraft[];
  'drafts.discard': number;
  'prefs.get': Prefs;
  'prefs.set': Prefs;
  'capture.save': { noteId: string };
  'search.run': SearchPage;
  'search.status': IndexStatus;
  'search.verify': { ok: boolean; skipped?: boolean };
  'search.rebuild': void;
  'search.saved.list': SavedSearch[];
  'search.saved.create': SavedSearch;
  'search.saved.rename': SavedSearch;
  'search.saved.delete': void;
  'search.saved.reset': void;
  'attachments.addPath': AttachmentRef;
  'attachments.list': AttachmentRef[];
  'attachments.remove': void;
  'attachments.info': AttachmentInfo;
  'attachments.cleanupPreview': CleanupPreview;
  'attachments.cleanupRun': CleanupResult;
  'attachments.verifyAll': VerifyReport;
  'portability.status': PortabilityStatus;
  'portability.setSchedule': ScheduleSettings;
  'portability.exportStart': JobStarted;
  'portability.importStart': JobStarted;
  'portability.backupNow': JobStarted;
  'portability.backupList': BackupSummary[];
  'portability.backupVerify': { ok: true; damaged: number; noteCount?: number };
  'portability.restoreStart': JobStarted;
  'bulk.move': { previous: { id: string; folderId: string | null }[]; skipped: string[] };
  'bulk.tag': { changed: string[]; skipped: string[] };
  'bulk.trash': { batchIds: string[] };
  'bulk.untrash': { restored: number; skipped: number; ids: string[] };
  'bulk.export': JobStarted;
}
export type Reply<M extends MethodName> = Replies[M];

/** Events main pushes to renderers. `changed` never carries note text. */
export type RpcEvent =
  | {
      type: 'changed';
      entity: 'note' | 'folder' | 'tag' | 'trash' | 'attachment';
      ids?: string[];
      /** Set only by notes.save: an autosave, not a structural change. */
      content?: true;
    }
  | { type: 'draftError'; noteId: string; message: string }
  | { type: 'command'; id: string }
  | { type: 'flushRequest'; token: string }
  | {
      type: 'searchState';
      state: 'ready' | 'dirty' | 'rebuilding' | 'error';
      progress?: { done: number; total: number };
      /** With state 'error': why the automatic rebuild gave up. */
      message?: string;
    }
  | { type: 'status'; message: string; level: 'info' | 'warn' }
  | {
      type: 'job';
      jobId: string;
      kind: JobKind;
      phase: string;
      done: number;
      total: number;
      /** Only on the final event of a job that succeeded. */
      result?: JobResult;
      /** Only on the final event of a job that failed or was cancelled. */
      error?: RpcError;
    };

/** What the preload exposes as `window.mossnote`. */
export interface Bridge {
  rpc(method: string, args?: unknown): Promise<RpcResult<unknown>>;
  onEvent(cb: (e: RpcEvent) => void): () => void;
}
