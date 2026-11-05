import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AttachmentsApi } from '../attachments/index.ts';
import { nodeAttachFs, type AttachFs } from '../attachments/fsport.ts';
import { getMeta, setMeta } from '../db/meta.ts';
import type { Clock } from '../db/types.ts';
import { quickCheck } from '../integrity/check.ts';
import { err, ok, type Result } from '../result.ts';
import type { Store } from '../store/store.ts';
import { createBackup, lastAutoAt, pruneLibrary, verifyPackageFile, type BackupRequest, type BackupResult, type Progress } from './backup.ts';
import { createBulkApi } from './bulk.ts';
import type { CryptoParams } from './crypto.ts';
import { toPortResult } from './errors.ts';
import { runExport, type ExportRequest, type ExportResult } from './export.ts';
import { findPendingImport, runImport, sweepImportStages, type ImportLimits, type ImportReport, type ImportRequest } from './import.ts';
import { libraryBytes, listLibrary, resolveId, type BackupSummary } from './library.ts';
import { stageRestore, sweepTemp, type StagedRestore } from './restore.ts';
import { createBackupScheduler, DEFAULT_SCHEDULE, type ScheduleSettings } from './schedule.ts';

export * from './backup.ts';
export * from './bulk.ts';
export { decryptStream, encryptStream, isEncrypted } from './crypto.ts';
export type { CryptoParams } from './crypto.ts';
export * from './errors.ts';
export * from './export.ts';
export * from './frontmatter.ts';
export * from './import.ts';
export * from './jobs.ts';
export * from './library.ts';
export * from './names.ts';
export * from './package.ts';
export * from './restore.ts';
export * from './schedule.ts';
export * from './tar.ts';

const SETTINGS_KEY = 'backup_settings';
const settingsSchema = z
  .object({
    auto: z.boolean(),
    intervalHours: z.number().int().min(1).max(168),
    keep: z.number().int().min(1).max(100),
  })
  .strict();

export type RestoreSource = { id: string } | { file: string };

export interface LibraryDeps {
  dbPath: string;
  root?: string;
  fs?: AttachFs;
  clock?: Clock;
}

/** Backup library operations that need no open workspace: used in recovery mode (the database is corrupt). */
export function createLibrary(d: LibraryDeps) {
  const fs = d.fs ?? nodeAttachFs;
  const clock = d.clock ?? { now: () => Date.now() };
  const root = d.root ?? join(dirname(d.dbPath), 'attachments');
  return {
    list: (): BackupSummary[] => listLibrary(d.dbPath),
    resolve: (id: string): string | undefined => resolveId(d.dbPath, id),
    totalBytes: (): number => libraryBytes(d.dbPath),
    async verify(id: string, passphrase?: string, signal?: AbortSignal): Promise<Result<{ damaged: number; noteCount?: number }>> {
      const path = resolveId(d.dbPath, id);
      if (!path) return err('not_found', 'That backup is not in the library.');
      try {
        if (id.endsWith('.sqlite')) {
          const q = quickCheck(path);
          if (!q.ok) return q;
          return q.value === 'ok' ? ok({ damaged: 0 }) : err('corrupt', 'This pre-migration copy failed its integrity check.');
        }
        const r = await verifyPackageFile(path, passphrase, signal);
        return ok({ damaged: r.manifest.damaged.length, noteCount: r.manifest.noteCount });
      } catch (e) {
        return toPortResult(e);
      }
    },
    /** Stages a verified restore and writes the journal; the swap happens at the next start. */
    stageRestore(src: RestoreSource, passphrase?: string, onProgress?: Progress, signal?: AbortSignal): Promise<Result<StagedRestore>> {
      let file: string | undefined;
      if ('id' in src) {
        file = resolveId(d.dbPath, src.id);
        if (!file || !src.id.endsWith('.mossbak'))
          return Promise.resolve(err('not_found', 'That backup cannot be restored.'));
      } else file = src.file;
      return stageRestore({ dbPath: d.dbPath, root, fs, clock }, { file, passphrase, onProgress, signal });
    },
  };
}

export interface PortabilityOptions {
  appVersion?: string;
  fs?: AttachFs;
  /** Test seams. */
  crypto?: CryptoParams;
  importLimits?: Partial<ImportLimits>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  onWarn?: (message: string) => void;
  startDelayMs?: number;
}

export function createPortability(store: Store, attachments: AttachmentsApi, opts: PortabilityOptions = {}) {
  const fs = opts.fs ?? nodeAttachFs;
  const clock = store.clock;
  const root = attachments.root;
  const library = createLibrary({ dbPath: store.path, root, fs, clock });
  const bd = { store, root, fs, clock, appVersion: opts.appVersion, crypto: opts.crypto };
  const jobs = attachments._jobs; // one mutex with Cleanup/verify (decision M11)

  const readSettings = (): ScheduleSettings => {
    try {
      const p = settingsSchema.safeParse(JSON.parse(getMeta(store.db, SETTINGS_KEY) ?? '{}'));
      return p.success ? p.data : { ...DEFAULT_SCHEDULE };
    } catch {
      return { ...DEFAULT_SCHEDULE };
    }
  };
  const writeSettings = (next: ScheduleSettings): Result<ScheduleSettings> => {
    const p = settingsSchema.safeParse(next);
    if (!p.success) return err('validation', p.error.message);
    return store.mutate({}, (tx) => {
      setMeta(tx.db, SETTINGS_KEY, JSON.stringify(p.data));
      return ok(p.data);
    });
  };

  const backup = (req: BackupRequest): Promise<Result<BackupResult>> =>
    jobs.run(async () => {
      const r = await createBackup(bd, req);
      if (r.ok && req.file === undefined) {
        if (req.kind === 'auto')
          store.mutate({}, (tx) => {
            setMeta(tx.db, 'backup_last_auto_at', String(clock.now()));
            return ok(undefined);
          });
        // Retention only after a NEWER backup was read back clean (C2): a damaged one never counts.
        if (r.value.damaged.length === 0) pruneLibrary(store.path, readSettings().keep);
      }
      return r;
    });

  const scheduler = createBackupScheduler({
    now: () => clock.now(),
    setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms).unref()),
    clearTimer: opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)),
    settings: readSettings,
    lastAutoAt: () => lastAutoAt(store),
    startDelayMs: opts.startDelayMs,
    onWarn: opts.onWarn,
    run: async () => {
      if (jobs.busy) return { ok: true }; // a job is running; the next check retries
      const r = await backup({ kind: 'auto' });
      return r.ok
        ? { ok: true }
        : { ok: false, message: `Automatic backup failed: ${r.error.message}` };
    },
  });

  try {
    sweepTemp(store.path);
    sweepImportStages(dirname(store.path));
  } catch {
    /* best effort */
  }

  return {
    library,
    scheduler,
    bulk: createBulkApi(store),
    settings: { get: readSettings, set: writeSettings },
    backup,
    /** Stages a restore (inside the job mutex). The caller then restarts the app. */
    restore: (src: RestoreSource, passphrase?: string, onProgress?: Progress, signal?: AbortSignal): Promise<Result<StagedRestore>> =>
      jobs.run(() => library.stageRestore(src, passphrase, onProgress, signal)),
    verify: (id: string, passphrase?: string, signal?: AbortSignal) => jobs.run(() => library.verify(id, passphrase, signal)),
    export: (req: ExportRequest): Promise<Result<ExportResult>> =>
      jobs.run(() => runExport({ store, root, fs, clock }, req)),
    import: (req: ImportRequest): Promise<Result<ImportReport>> =>
      jobs.run(() => runImport({ store, attachments, clock, limits: opts.importLimits }, req)),
    /** An interrupted import waits for `import()`; true means the next import resumes it. */
    hasPendingImport: (): boolean => findPendingImport(dirname(store.path)) !== undefined,
    get busy(): boolean {
      return jobs.busy;
    },
    /** Quit drain: stops the scheduler and waits for the running job. */
    async drain(): Promise<void> {
      await scheduler.stop();
      await attachments.idle();
    },
  };
}
export type Portability = ReturnType<typeof createPortability>;
