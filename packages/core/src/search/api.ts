import type { Result } from '../result.ts';
import type { Store } from '../store/store.ts';
import type { SearchPage, SearchParams } from './params.ts';
import { createIndexAdmin, type IndexStatus, type StepResult } from './rebuild.ts';
import { createSavedSearches } from './saved.ts';
import { createSearch } from './search.ts';

export interface SearchApiOptions {
  /** Notes per rebuild slice. Tests lower it. */
  sliceSize?: number;
}

/** `ws.search`: query, index health, chunked rebuild, saved searches. Electron-free. */
export function createSearchApi(store: Store, opts: SearchApiOptions = {}) {
  const admin = createIndexAdmin(store, opts.sliceSize);
  const q = createSearch(store, admin);
  const saved = createSavedSearches(store);
  return {
    search: (params: SearchParams): Result<SearchPage> => q.search(params),
    status: (): Result<IndexStatus> => admin.status(),
    /** One slice (~500 notes). A dirty index is replaced first. The dispatcher loops this between events. */
    rebuildStep: (): Result<StepResult> => admin.rebuildStep(),
    /** Re-arms a failed rebuild and marks the index dirty; the dispatcher's pump does the work (`search.rebuild`). */
    requestRebuild: (): Result<void> => admin.requestRebuild(),
    /** All slices now (tests, CLI, the "Rebuild search index" command). */
    rebuild: (): Result<void> => admin.rebuild(),
    markDirty: (reason: string): Result<void> => admin.markDirty(reason),
    /** Extra (not frozen): deep integrity-check (blocking, O(index)); a failure marks the index dirty. */
    verify: (): Result<{ ok: boolean; skipped?: boolean }> => admin.verify(),
    savedSearches: saved,
  };
}
export type SearchApi = ReturnType<typeof createSearchApi>;
