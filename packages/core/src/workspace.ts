import {
  createAttachmentsApi,
  type AttachmentsApi,
  type AttachmentsOptions,
} from './attachments/index.ts';
import { getMeta } from './db/meta.ts';
import { createDraftsApi, type DraftsApi } from './drafts/index.ts';
import { createFoldersApi } from './folders/folders.ts';
import { createNotesApi } from './notes/notes.ts';
import { createPortability, pendingRestoreExists, type Portability, type PortabilityOptions } from './portability/index.ts';
import { err, type Result } from './result.ts';
import { openStore, type OpenOptions, type Store } from './store/store.ts';
import { createSearchApi, type SearchApi } from './search/index.ts';
import { readPrefs } from './rpc/prefs.ts';
import { createTagsApi } from './tags/tags.ts';
import { createTrashApi } from './trash/trash.ts';
import { createVersionsApi } from './versions/versions.ts';

/** The one object the app holds: a locked, integrity-checked store plus its domain APIs. */
export interface Workspace {
  readonly store: Store;
  readonly notes: ReturnType<typeof createNotesApi>;
  readonly folders: ReturnType<typeof createFoldersApi>;
  readonly tags: ReturnType<typeof createTagsApi>;
  readonly trash: ReturnType<typeof createTrashApi>;
  readonly versions: ReturnType<typeof createVersionsApi>;
  readonly drafts: DraftsApi;
  readonly search: SearchApi;
  readonly attachments: AttachmentsApi;
  readonly portability: Portability;
  /** Flushes pending draft text, folds the WAL and releases the lock. Always closes; an error means the last keystrokes were not saved. */
  close(): Result<void>;
}

export interface WorkspaceOptions extends OpenOptions {
  /** Test and desktop seams: file port, PDF extractor, blob directory. */
  attachments?: AttachmentsOptions;
  portability?: PortabilityOptions;
}

/**
 * Opens the database at `dbPath` behind the workspace lock and the integrity check
 * (CS-9, CS-10); openStore applies both by default.
 */
export function openWorkspace(dbPath: string, opts: WorkspaceOptions = {}): Result<Workspace> {
  // A staged restore must be applied (applyPendingRestore) before opening: opening now could create an
  // empty workspace next to the live files the swap is about to move (decision C1).
  if (pendingRestoreExists(dbPath))
    return err('unavailable', 'A backup restore is waiting to be applied. Restart Mossnote to finish it.');
  const opened = openStore(dbPath, opts);
  if (!opened.ok) return opened;
  const store = opened.value;
  const drafts = createDraftsApi(store);
  const search = createSearchApi(store);
  const attachments = createAttachmentsApi(store, {
    ...opts.attachments,
    // The limit is a user preference (default 200 MB, hard cap 1 GB), read on every add.
    maxBytes: opts.attachments?.maxBytes ?? (() => readPrefs(store).attachmentMaxBytes),
  });
  // Migration 0003 marks the index dirty. Nothing to refill on an empty workspace, so it is ready at once;
  // with notes the dispatcher's pump (chunked) does the work.
  if (
    getMeta(store.db, 'search_state') === 'dirty' &&
    getMeta(store.db, 'search_dirty_reason') === 'migration 0003' &&
    (store.db.prepare('SELECT 1 AS x FROM notes LIMIT 1').get() as unknown) === undefined
  )
    search.rebuild();
  const portability = createPortability(store, attachments, opts.portability);
  return {
    ok: true,
    value: {
      store,
      notes: createNotesApi(store),
      folders: createFoldersApi(store),
      tags: createTagsApi(store),
      trash: createTrashApi(store),
      versions: createVersionsApi(store),
      drafts,
      search,
      attachments,
      portability,
      close() {
        void portability.scheduler.stop();
        const f = drafts.flush();
        drafts.dispose();
        attachments.dispose();
        const c = store.close();
        return f.ok ? c : f;
      },
    },
  };
}
