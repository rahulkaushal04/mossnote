import { isAbsolute } from 'node:path';
import type { z } from 'zod';
import { createDraftsApi } from '../drafts/index.ts';
import { createLibrary } from '../portability/index.ts';
import { createJobRunner, type JobEventOut } from '../portability/jobs.ts';
import { lastAutoAt } from '../portability/backup.ts';
import { pendingRestoreExists } from '../portability/restore.ts';
import type { RecoveryInfo } from '../integrity/check.ts';
import { err, ok, type AppError, type Result } from '../result.ts';
import type { Workspace } from '../workspace.ts';
import { captureSave } from './capture.ts';
import {
  methods,
  type JobResult,
  type MethodName,
  type Replies,
  type RpcEvent,
  type RpcResult,
} from './contract.ts';
import { readPrefs, writePrefs } from './prefs.ts';
import { deriveTitle } from './title.ts';

export interface DispatcherOptions {
  platform?: string;
  /** Called for `app.flushed {token}` (the quit handshake lives in desktop). */
  onFlushed?: (token: string) => void;
  /** `app.quit`: desktop routes it through the lifecycle sequencer. */
  onQuit?: () => void;
  /** `app.openCapture`: desktop opens or focuses the capture window. */
  onOpenCapture?: () => void;
  /** Runs the next rebuild slice later. Default: setImmediate, so the event loop stays responsive. Tests inject a manual one. */
  schedule?: (run: () => void) => void;
  /**
   * Main-process hook: turns an opaque token (issued when the user picked or dropped a file) into the
   * absolute path, or undefined when unknown or expired. Without it `attachments.addPath` is unavailable.
   * The renderer never supplies a path.
   */
  resolveUploadPath?: (token: string) => string | undefined;
  /** Runs PDF text extraction later (default setImmediate). Tests inject a manual one. */
  scheduleExtract?: (run: () => void) => void;
  /**
   * Path of the database. Needed in recovery mode (the workspace failed with `corrupt`, which carries it
   * too) so the backup library can still be listed and restored from.
   */
  dbPath?: string;
  /**
   * Main-process dialogs (the renderer never supplies a path). Each returns an absolute path, or null
   * when the user cancelled. Without a hook the method is `unavailable`.
   */
  pickExportDir?: () => Promise<string | null>;
  pickImportDir?: () => Promise<string | null>;
  /** `suggestedName` is e.g. "Mossnote backup 2026-11-05.mossbak". */
  pickBackupSavePath?: (suggestedName: string) => Promise<string | null>;
  pickBackupOpenPath?: () => Promise<string | null>;
  /** After a restore was staged and verified: desktop relaunches through the normal flush lifecycle. */
  restartForRestore?: () => void;
}
export interface Dispatcher {
  /** Never throws. Only `{code,message}` leaves on error. */
  handle(method: unknown, args: unknown): Promise<RpcResult<unknown>>;
  onEvent(cb: (e: RpcEvent) => void): () => void;
  /** Pushes an event to every listener (main-process status messages). */
  emit(e: RpcEvent): void;
  /** Quit drain: stops the auto-backup scheduler, cancels nothing, waits for the running job to finish. Call before close(). */
  drain(): Promise<void>;
  /** Flushes drafts and closes the workspace; every later call is `unavailable`. */
  close(): Result<void>;
}

const PUMP_AFTER =
  /^(search\.(?!saved\.)|notes\.|folders\.|tags\.|trash\.|capture\.|attachments\.|bulk\.|portability\.)/;

type Handlers = {
  [M in MethodName]: (
    a: z.output<(typeof methods)[M]['args']>,
  ) => Result<Replies[M]> | Promise<Result<Replies[M]>>;
};
type AnyHandler = (a: never) => Result<unknown> | Promise<Result<unknown>>;

const strip = <T>(r: Result<T>): RpcResult<T> =>
  r.ok ? r : { ok: false, error: { code: r.error.code, message: String(r.error.message) } };

const summary = <T extends { body?: string }>(n: T): Omit<T, 'body'> => {
  const s = { ...n };
  delete s.body;
  return s;
};

export function createDispatcher(wsr: Result<Workspace>, opts: DispatcherOptions = {}): Dispatcher {
  const listeners = new Set<(e: RpcEvent) => void>();
  const emit = (e: RpcEvent) => {
    for (const l of [...listeners])
      try {
        l(e);
      } catch {
        /* a bad listener must not break a mutation */
      }
  };
  const platform = opts.platform ?? process.platform;
  let closed = false;
  let pumpIndex = (): void => {};

  const status = (): Result<Replies['app.status']> =>
    ok(
      wsr.ok
        ? { state: 'ready', platform }
        : { state: 'error', code: wsr.error.code, message: wsr.error.message, platform },
    );

  // These two work even when the workspace failed to open: the fatal screen's Quit and the quit handshake.
  const appHandlers: Pick<Handlers, 'app.flushed' | 'app.quit'> = {
    'app.flushed': (a) => {
      opts.onFlushed?.(a.token);
      return ok(undefined);
    },
    'app.quit': () => {
      opts.onQuit?.();
      return ok(undefined);
    },
  };
  const jobs = createJobRunner(
    (e: JobEventOut) =>
      emit({
        type: 'job',
        jobId: e.jobId,
        kind: e.kind,
        phase: e.phase,
        done: e.done,
        total: e.total,
        ...(e.result ? { result: e.result as JobResult } : {}),
        ...(e.error ? { error: e.error } : {}),
      }),
    () => (wsr.ok ? wsr.value.portability.busy : false),
  );
  const BUSY = 'Another export, import or backup is already running.';
  /** A main-process dialog result: null = cancelled; anything but an absolute path is refused. */
  const pickPath = async (
    pick: (() => Promise<string | null>) | undefined,
    what: string,
  ): Promise<Result<string | null>> => {
    if (!pick) return err('unavailable', `${what} is not available here.`);
    const p = await pick();
    if (p === null) return ok(null);
    return typeof p === 'string' && isAbsolute(p)
      ? ok(p)
      : err('internal', 'The file dialog returned an invalid location.');
  };
  type RestoreArgs = z.output<(typeof methods)['portability.restoreStart']['args']>;
  const startRestore = async (
    busy: boolean,
    stage: (
      src: { id: string } | { file: string },
      passphrase: string | undefined,
      progress: (phase: string, done: number, total: number) => void,
      signal: AbortSignal,
    ) => Promise<Result<{ backupCreatedAt: string; noteCount: number; damaged: number }>>,
    a: RestoreArgs,
  ): Promise<Result<Replies['portability.restoreStart']>> => {
    if (busy || jobs.busy) return err('unavailable', BUSY);
    let src: { id: string } | { file: string };
    if ('id' in a.source) src = { id: a.source.id };
    else {
      const f = await pickPath(opts.pickBackupOpenPath, 'Restore from a file');
      if (!f.ok) return f;
      if (f.value === null) return ok({ cancelled: true as const });
      src = { file: f.value };
    }
    const started = jobs.start('restore', async (ctl) => {
      const r = await stage(src, a.passphrase, ctl.progress, ctl.signal);
      if (!r.ok) return r;
      setImmediate(() => opts.restartForRestore?.()); // after the final job event has been emitted
      return ok<JobResult>({ kind: 'restore', restartRequired: true, ...r.value });
    });
    return started;
  };
  let table = new Map<string, AnyHandler>(
    Object.entries(appHandlers) as [string, AnyHandler][],
  );
  // Recovery mode: the workspace is corrupt, but the backup library and a restore still work.
  const recoveryDb = wsr.ok
    ? undefined
    : wsr.error.code === 'corrupt'
      ? (opts.dbPath ?? (wsr.error.cause as RecoveryInfo | undefined)?.dbPath)
      : undefined;
  if (recoveryDb) {
    const lib = createLibrary({ dbPath: recoveryDb });
    table.set('portability.backupList', (() => ok(lib.list())) as AnyHandler);
    table.set('portability.backupVerify', ((a: { id: string; passphrase?: string }) =>
      lib.verify(a.id, a.passphrase).then((r) => (r.ok ? ok({ ok: true as const, ...r.value }) : r))) as AnyHandler);
    table.set('portability.restoreStart', ((a: RestoreArgs) =>
      startRestore(false, (src, pass, pr, sg) => lib.stageRestore(src, pass, pr, sg), a)) as AnyHandler);
  }
  if (wsr.ok) {
    const ws = wsr.value;
    // Own drafts instance so its onError becomes an event; closed (flushed) before the workspace.
    const drafts = createDraftsApi(ws.store, {
      // The journal reports which note failed; the id is never parsed out of the message.
      onError: (e, noteId) =>
        emit({
          type: 'draftError',
          noteId,
          message: String((e as AppError)?.message ?? 'draft not saved'),
        }),
    });
    const changed = (
      entity: 'note' | 'folder' | 'tag' | 'trash' | 'attachment',
      ids?: string[],
    ) =>
      emit(ids ? { type: 'changed', entity, ids } : { type: 'changed', entity });
    const after = <T>(r: Result<T>, fn: (v: T) => void): Result<T> => {
      if (r.ok) fn(r.value);
      return r;
    };
    const map = <T, U>(r: Result<T>, f: (v: T) => U): Result<U> => (r.ok ? ok(f(r.value)) : r);

    // PDF text arrives after the add returned (AT-7): extract later, then tell the UI which notes changed.
    const scheduleExtract = opts.scheduleExtract ?? ((run: () => void) => void setImmediate(run));
    const kickExtract = (): void =>
      scheduleExtract(() => {
        if (closed) return;
        void ws.attachments
          .extractPending()
          .then((r) => {
            if (r.processed > 0 && !closed) changed('attachment', r.noteIds);
          })
          .catch(() => undefined);
      });

    const startExport = async (
      scope: z.output<(typeof methods)['portability.exportStart']['args']>['scope'],
    ): Promise<Result<Replies['portability.exportStart']>> => {
      const P = ws.portability;
      if (jobs.busy || P.busy) return err('unavailable', BUSY);
      const p = await pickPath(opts.pickExportDir, 'Export');
      if (!p.ok) return p;
      if (p.value === null) return ok({ cancelled: true as const });
      const dir = p.value;
      return jobs.start('export', async (ctl) => {
        const r = await P.export({ dir, scope, onProgress: ctl.progress, signal: ctl.signal });
        if (!r.ok) return r;
        const v = r.value;
        return ok<JobResult>({
          kind: 'export',
          folderName: v.folderName,
          notes: v.notes,
          attachments: v.attachments,
          warnings: v.warnings,
        });
      });
    };

    const h: Handlers = {
      'app.status': status,
      ...appHandlers,
      'app.openCapture': () => {
        opts.onOpenCapture?.();
        return ok(undefined);
      },

      'notes.list': (a) => ws.notes.list(a),
      'notes.get': (a) => ws.notes.get(a.id),
      'notes.create': (a) => {
        const body = a.body ?? '';
        return after(
          ws.notes.create({}, { title: deriveTitle(body), body, folderId: a.folderId ?? null }),
          (n) => changed('note', [n.id]),
        );
      },
      'notes.save': (a) => {
        // The title, the CAS and the draft cleanup (MAX seq) all happen in one core transaction.
        const r = ws.notes.save({ expectedContentHash: a.expectedContentHash }, a.id, {
          title: deriveTitle(a.body),
          body: a.body,
        });
        if (!r.ok) return r;
        drafts.discardPending(a.id); // the save text is at least as new as anything still buffered
        const n = r.value;
        emit({ type: 'changed', entity: 'note', ids: [n.id], content: true });
        return ok({
          rev: n.rev,
          contentHash: n.contentHash,
          title: n.title,
          updatedAt: n.updatedAt,
        });
      },
      'notes.move': (a) =>
        after(map(ws.notes.move({}, a.id, a.folderId), summary), () => changed('note', [a.id])),
      'notes.setFavorite': (a) =>
        after(map(ws.notes.setFavorite({}, a.id, a.favorite), summary), () =>
          changed('note', [a.id]),
        ),
      'notes.trash': (a) =>
        after(ws.trash.trashNote({}, a.id), () => {
          changed('note', [a.id]);
          changed('trash');
        }),

      'folders.list': () => ws.folders.list(),
      'folders.create': (a) =>
        after(ws.folders.create({}, { name: a.name, parentId: a.parentId ?? null }), (f) =>
          changed('folder', [f.id]),
        ),
      'folders.rename': (a) =>
        after(ws.folders.rename({}, a.id, a.name), () => changed('folder', [a.id])),
      'folders.move': (a) =>
        after(ws.folders.move({}, a.id, a.parentId), () => changed('folder', [a.id])),
      'folders.trash': (a) =>
        after(ws.trash.trashFolder({}, a.id), () => {
          changed('folder', [a.id]);
          changed('note'); // descendants leave the lists
          changed('trash');
        }),

      'tags.list': () => ws.tags.list(),
      'tags.create': (a) => after(ws.tags.create({}, a.name), (t) => changed('tag', [t.id])),
      'tags.rename': (a) =>
        after(
          ws.tags.rename({}, a.id, a.name, a.confirmMerge ? { confirmMerge: true } : {}),
          (r) => {
            if (r.kind !== 'needsMerge') {
              changed('tag', [a.id]);
              if (r.kind === 'merged') changed('note');
            }
          },
        ),
      'tags.forNote': (a) => ws.tags.listForNote(a.noteId),
      'tags.tagNote': (a) =>
        after(ws.tags.tagNote({}, a.noteId, a.tagId), () => {
          changed('tag', [a.tagId]);
          changed('note', [a.noteId]);
        }),
      'tags.untagNote': (a) =>
        after(ws.tags.untagNote({}, a.noteId, a.tagId), () => {
          changed('tag', [a.tagId]);
          changed('note', [a.noteId]);
        }),

      'trash.list': () => ws.trash.list(),
      'trash.restore': (a) =>
        after(ws.trash.restoreBatch({}, a.batchId), (b) => {
          changed(b.entity, [b.id]);
          changed('trash');
        }),
      'trash.purge': (a) =>
        after(ws.trash.purgeBatch({}, a.batchId, { confirmed: true }), () => {
          changed('trash');
          changed('note');
          changed('folder');
        }),

      'drafts.write': (a) => drafts.write(a.noteId, a.text, a.base),
      'drafts.flush': (a) => drafts.flush(a.noteId),
      'drafts.recover': (a) => drafts.recover(a.noteId),
      'drafts.discard': (a) => drafts.discardUpTo(a.noteId, a.upToSeq),

      'prefs.get': () => ok(readPrefs(ws.store)),
      'prefs.set': (a) => writePrefs(ws.store, a),

      'search.run': (a) => ws.search.search(a),
      'search.status': () => ws.search.status(),
      'search.verify': () => ws.search.verify(),
      'search.rebuild': () => ws.search.requestRebuild(),
      'search.saved.list': () => ws.search.savedSearches.list(),
      'search.saved.create': (a) => ws.search.savedSearches.create(a.name, a.spec),
      'search.saved.rename': (a) => ws.search.savedSearches.rename(a.id, a.name),
      'search.saved.delete': (a) => ws.search.savedSearches.delete(a.id),
      'search.saved.reset': () => ws.search.savedSearches.reset(),

      'attachments.addPath': async (a) => {
        if (!opts.resolveUploadPath) return err('unavailable', 'Attaching files is not available here.');
        const path = opts.resolveUploadPath(a.token);
        if (!path) return err('validation', 'That file selection expired. Choose the file again.');
        const r = await ws.attachments.addFromPath({}, a.noteId, path);
        if (r.ok) {
          changed('attachment', [a.noteId]);
          kickExtract();
        }
        return r;
      },
      'attachments.list': (a) => ws.attachments.listForNote(a.noteId),
      'attachments.remove': (a) =>
        after(
          map(ws.attachments.removeRef({}, a.refId), () => undefined),
          () => changed('attachment'),
        ),
      'attachments.info': (a) =>
        ws.attachments.info(a.sha256, { noteId: a.noteId, verify: a.verify }),
      'attachments.cleanupPreview': () => ws.attachments.cleanupPreview(),
      'attachments.cleanupRun': async (a) =>
        after(await ws.attachments.cleanupRun(a.sha256s, { confirmed: true }), () =>
          changed('attachment'),
        ),
      'attachments.verifyAll': async () =>
        after(await ws.attachments.verifyAll(), () => changed('attachment')),

      'portability.status': () => {
        const st = jobs.status();
        const P = ws.portability;
        return ok({
          ...(st.job ? { job: st.job } : {}),
          ...(st.last
            ? {
                lastJob: {
                  jobId: st.last.jobId,
                  kind: st.last.kind,
                  ok: st.last.ok,
                  ...(st.last.error ? { error: st.last.error } : {}),
                },
              }
            : {}),
          schedule: P.settings.get(),
          lastAutoBackupAt: lastAutoAt(ws.store) || null,
          libraryBytes: P.library.totalBytes(),
          pendingImport: P.hasPendingImport(),
          restorePending: pendingRestoreExists(ws.store.path),
        });
      },
      'portability.setSchedule': (a) => ws.portability.settings.set(a),
      'portability.exportStart': (a) => startExport(a.scope),
      'bulk.export': (a) => startExport({ kind: 'notes', ids: a.ids }),
      'portability.importStart': async () => {
        const P = ws.portability;
        if (jobs.busy || P.busy) return err('unavailable', BUSY);
        let dir: string | undefined;
        if (!P.hasPendingImport()) {
          const p = await pickPath(opts.pickImportDir, 'Import');
          if (!p.ok) return p;
          if (p.value === null) return ok({ cancelled: true as const });
          dir = p.value;
        }
        return jobs.start('import', async (ctl) => {
          const r = await P.import({ dir, onProgress: ctl.progress, signal: ctl.signal });
          if (!r.ok) return r;
          changed('note');
          changed('folder');
          changed('tag');
          changed('attachment');
          pumpIndex();
          kickExtract();
          return ok<JobResult>({ kind: 'import', ...r.value });
        });
      },
      'portability.backupNow': async (a) => {
        const P = ws.portability;
        if (jobs.busy || P.busy) return err('unavailable', BUSY);
        let file: string | undefined;
        if (a.to === 'file') {
          const day = new Date(ws.store.clock.now()).toISOString().slice(0, 10);
          const pick = opts.pickBackupSavePath;
          const p = await pickPath(pick && (() => pick(`Mossnote backup ${day}.mossbak`)), 'Save backup as');
          if (!p.ok) return p;
          if (p.value === null) return ok({ cancelled: true as const });
          file = p.value;
        }
        return jobs.start('backup', async (ctl) => {
          const r = await P.backup({
            kind: 'manual',
            file,
            passphrase: a.passphrase,
            onProgress: ctl.progress,
            signal: ctl.signal,
          });
          if (!r.ok) return r;
          const v = r.value;
          return ok<JobResult>({
            kind: 'backup',
            id: v.id,
            encrypted: v.encrypted,
            size: v.size,
            noteCount: v.noteCount,
            attachments: v.attachments,
            damaged: v.damaged.length,
            verified: true,
          });
        });
      },
      'portability.backupList': () => ok(ws.portability.library.list()),
      'portability.backupVerify': async (a) => {
        const r = await ws.portability.verify(a.id, a.passphrase);
        return r.ok ? ok({ ok: true as const, ...r.value }) : r;
      },
      'portability.restoreStart': (a) =>
        startRestore(
          ws.portability.busy,
          (src, pass, pr, sg) => ws.portability.restore(src, pass, pr, sg),
          a,
        ),
      'bulk.move': (a) =>
        after(ws.portability.bulk.move(a), (v) => {
          if (v.previous.length) changed('note', v.previous.map((p) => p.id));
        }),
      'bulk.tag': (a) =>
        after(ws.portability.bulk.tag(a), (v) => {
          changed('tag', [a.tagId]);
          if (v.changed.length) changed('note', v.changed);
        }),
      'bulk.trash': (a) =>
        after(ws.portability.bulk.trash(a), () => {
          changed('note', a.ids);
          changed('trash');
        }),
      'bulk.untrash': (a) =>
        after(ws.portability.bulk.untrash(a), (v) => {
          if (v.ids.length) changed('note', v.ids);
          changed('trash');
        }),

      'capture.save': (a) =>
        map(
          after(captureSave(ws, a.text), (c) => {
            if (c.inboxCreated) changed('folder', [c.inboxId]);
            changed('note', [c.noteId]);
          }),
          (c) => ({ noteId: c.noteId }),
        ),
    };
    table = new Map(Object.entries(h) as [string, AnyHandler][]);

    // Index rebuild: one slice per scheduler tick while the index is not ready.
    const schedule = opts.schedule ?? ((run: () => void) => void setImmediate(run));
    let last = '';
    let pumping = false;
    const publish = (s: Result<Replies['search.status']>): boolean => {
      if (!s.ok) return false;
      const v = s.value;
      const e: RpcEvent =
        v.state === 'rebuilding'
          ? { type: 'searchState', state: 'rebuilding', progress: v.progress }
          : v.state === 'error'
            ? { type: 'searchState', state: 'error', message: v.message }
            : { type: 'searchState', state: v.state };
      const key = JSON.stringify(e);
      if (key !== last) {
        last = key;
        emit(e);
      }
      return v.state === 'dirty' || v.state === 'rebuilding';
    };
    // A failed step is counted in core: one automatic retry (the pump simply goes on), and after the
    // second failure status() reports 'error', so publish() returns false and the pump stops until a
    // manual `search.rebuild` (or a restart) re-arms it.
    const step = () => {
      pumping = false;
      if (closed) return;
      try {
        ws.search.rebuildStep();
        pump();
      } catch {
        /* stop; the next search call restarts the pump */
      }
    };
    const pump = () => {
      if (closed || pumping) return;
      try {
        if (!publish(ws.search.status())) return;
        pumping = true;
        schedule(step);
      } catch {
        pumping = false;
      }
    };
    pumpIndex = pump;
    pump();
    kickExtract(); // resume PDFs that were still pending when the app last closed

    return build(ws, drafts, table);
  }
  return build(undefined, undefined, table);

  function build(
    ws: Workspace | undefined,
    drafts: ReturnType<typeof createDraftsApi> | undefined,
    t: Map<string, AnyHandler>,
  ): Dispatcher {
    return {
      async handle(method, args) {
        try {
          // Own-property Map lookup: '__proto__', 'constructor', 'toString' never resolve.
          if (typeof method !== 'string' || !(method in methods) || !Object.hasOwn(methods, method))
            return strip(err('validation', 'unknown method'));
          const name = method as MethodName;
          if (closed) return strip(err('unavailable', 'workspace is closed'));
          if (!wsr.ok && name !== 'app.status' && !t.has(name)) return strip(wsr);
          const p = methods[name].args.safeParse(args === undefined ? {} : args);
          if (!p.success)
            return strip(
              err(
                'validation',
                p.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; '),
              ),
            );
          if (name === 'app.status') return strip(status());
          const fn = t.get(name);
          if (!fn) return strip(err('validation', 'unknown method'));
          const out = strip(await fn(p.data as never));
          // After anything that can quarantine the index (a failed-then-retried write) or ask for a rebuild.
          if (PUMP_AFTER.test(name)) pumpIndex();
          return out;
        } catch {
          return strip(err('internal', 'internal error'));
        }
      },
      emit,
      onEvent(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      async drain() {
        await jobs.drain();
        await ws?.portability.drain();
      },
      close() {
        if (closed || !ws || !drafts) {
          closed = true;
          return ok(undefined);
        }
        closed = true;
        const f = drafts.flush();
        drafts.dispose();
        const c = ws.close();
        listeners.clear();
        if (!f.ok) return f;
        return c;
      },
    };
  }
}
