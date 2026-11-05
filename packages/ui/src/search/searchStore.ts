import type { Args, Reply, RpcEvent } from '@mossnote/core/rpc';
import type { Timers } from '../editor/autosave';
import { createStore, type Store } from '../app/store';
import type { Client } from '../rpc/client';
import type { NavSelection, NavStore } from '../nav/navStore';
import type { ToastStore } from '../toast/toastStore';

export type SearchPage = Reply<'search.run'>;
export type SearchHit = SearchPage['hits'][number];
export type SavedSearch = Reply<'search.saved.list'>[number];
type Params = Args<'search.run'>;
type Sort = NonNullable<Params['sort']>;
type Dir = NonNullable<Params['dir']>;

export const DEBOUNCE_MS = 150;
export const PAGE = 50;
/** Rows kept in the DOM at most; past this the user is asked to refine (10k hits stay cheap). */
export const MAX_ROWS = 1000;
const REFRESH_PAGE = 100;

/**
 * Maps a calendar day to the instants where it starts and ends. Injectable so tests can pin an
 * offset or a DST rule; the default is the user's own (local) time zone.
 */
export interface DayZone {
  /** Epoch ms of local midnight starting y-m-d (month 1-12; day may overflow into the next month). */
  midnight(y: number, m: number, d: number): number;
  /** `YYYY-MM-DD` of the local calendar day containing the instant. */
  day(ms: number): string;
}
const p2 = (n: number) => String(n).padStart(2, '0');
export const localZone: DayZone = {
  midnight: (y, m, d) => new Date(y, m - 1, d).getTime(),
  day(ms) {
    const t = new Date(ms);
    return `${String(t.getFullYear()).padStart(4, '0')}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
  },
};
/** A zone with a constant offset east of UTC, in minutes (UTC+10 is 600). */
export const fixedZone = (offsetMin: number): DayZone => ({
  midnight: (y, m, d) => Date.UTC(y, m - 1, d) - offsetMin * 60_000,
  day: (ms) => new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10),
});

/** What the filter widgets hold. Dates are `YYYY-MM-DD` strings straight from <input type=date>. */
export interface UiFilters {
  favorite: boolean;
  /** All of them, also when an applied saved search holds several: never silently narrowed. */
  tagIds: string[];
  folderIds: string[];
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
}
export const NO_FILTERS: UiFilters = {
  favorite: false,
  tagIds: [],
  folderIds: [],
  createdFrom: '',
  createdTo: '',
  updatedFrom: '',
  updatedTo: '',
};

const ymd = (d: string): [number, number, number] | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00.000Z`)))
    return undefined; // also rejects 2024-02-30
  return [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))];
};
/** First instant of the given LOCAL calendar day (core receives plain UTC ms). */
export const dayStart = (d: string, zone: DayZone = localZone): number | undefined => {
  const p = ymd(d);
  const t = p && zone.midnight(...p);
  return t === undefined || t < 0 ? undefined : t;
};
/** Last millisecond of the local day: next local midnight minus 1 (a DST day is 23 or 25 h long). */
export const dayEnd = (d: string, zone: DayZone = localZone): number | undefined => {
  const p = ymd(d);
  const t = p && zone.midnight(p[0], p[1], p[2] + 1) - 1;
  return t === undefined || t < 0 ? undefined : t;
};

type CoreFilters = NonNullable<Params['filters']>;
export function toCoreFilters(f: UiFilters, zone: DayZone = localZone): CoreFilters {
  const out: CoreFilters = {};
  if (f.favorite) out.favorite = true;
  if (f.tagIds.length) out.tagIds = [...f.tagIds];
  if (f.folderIds.length) out.folderIds = [...f.folderIds];
  const set = (
    k: 'createdFrom' | 'createdTo' | 'updatedFrom' | 'updatedTo',
    v: number | undefined,
  ) => {
    if (v !== undefined) out[k] = v;
  };
  set('createdFrom', dayStart(f.createdFrom, zone));
  set('createdTo', dayEnd(f.createdTo, zone));
  set('updatedFrom', dayStart(f.updatedFrom, zone));
  set('updatedTo', dayEnd(f.updatedTo, zone));
  return out;
}
export function fromCoreFilters(f: CoreFilters | undefined, zone: DayZone = localZone): UiFilters {
  const day = (ms: number | undefined) => (ms === undefined ? '' : zone.day(ms));
  return {
    favorite: f?.favorite === true,
    tagIds: [...(f?.tagIds ?? [])],
    folderIds: [...(f?.folderIds ?? [])],
    createdFrom: day(f?.createdFrom),
    createdTo: day(f?.createdTo),
    updatedFrom: day(f?.updatedFrom),
    updatedTo: day(f?.updatedTo),
  };
}

/** M9: one scope semantics. The nav selection IS the scope (a folder searches its subtree). */
export function navToScope(sel: NavSelection): Params['scope'] {
  if (sel.kind === 'all') return undefined;
  return sel.id ? { kind: sel.kind, id: sel.id } : { kind: sel.kind };
}

export type IndexState =
  | { state: 'ready' | 'dirty' }
  | { state: 'rebuilding'; progress?: { done: number; total: number } }
  | { state: 'error'; message: string };

export interface SearchState {
  query: string;
  filters: UiFilters;
  sort: Sort;
  dir: Dir;
  status: 'idle' | 'loading' | 'ready' | 'rebuilding' | 'error' | 'indexError';
  hits: SearchHit[];
  hasMore: boolean;
  messages: string[];
  progress?: { done: number; total: number } | undefined;
  /** status 'error': the search failed; 'indexError': the index could not be rebuilt (message verbatim). */
  error?: string | undefined;
  /** Text for the polite live region; changes only when a reply settles. */
  announce: string;
  index: IndexState;
  saved: {
    status: 'loading' | 'ready' | 'error';
    items: SavedSearch[];
    error?: string;
    corrupt?: boolean;
  };
}

export interface SearchStore extends Store<SearchState> {
  /** Set by the mounted search box. */
  hooks: { focusInput?: () => void };
  start(): void;
  dispose(): void;
  setQuery(q: string): void;
  setFilters(patch: Partial<UiFilters>): void;
  setSort(sort: Sort, dir?: Dir): void;
  clear(): void;
  retry(): void;
  /** Asks core for a full rebuild; progress and the outcome arrive as searchState events. */
  rebuild(): Promise<void>;
  loadMore(): Promise<void>;
  /** The current search as a saved-search spec. */
  spec(): Args<'search.saved.create'>['spec'];
  apply(s: SavedSearch): void;
  loadSaved(): Promise<void>;
  verify(): Promise<void>;
  onEvent(e: RpcEvent): void;
}

export interface SearchDeps {
  client: Client;
  nav: NavStore;
  timers: Timers;
  toasts: ToastStore;
  /** Time zone for date filters; tests inject a fixed one. */
  zone?: DayZone;
}

export function createSearchStore({
  client,
  nav,
  timers,
  toasts,
  zone = localZone,
}: SearchDeps): SearchStore {
  const store = createStore<SearchState>({
    query: '',
    filters: NO_FILTERS,
    sort: 'relevance',
    dir: 'desc',
    status: 'idle',
    hits: [],
    hasMore: false,
    messages: [],
    announce: '',
    index: { state: 'ready' },
    saved: { status: 'loading', items: [] },
  });
  let seq = 0; // every request takes a number; a reply for an older one is dropped
  let timer: unknown;
  let pending: 'new' | 'refresh' | undefined;
  let cursor: string | undefined;
  let offNav: (() => void) | undefined;
  let applying = false;

  const active = () => store.get().query.trim() !== '';
  const params = (): Params => {
    const s = store.get();
    const scope = navToScope(nav.get());
    const filters = toCoreFilters(s.filters, zone);
    return {
      query: s.query.trim(),
      ...(scope ? { scope } : {}),
      ...(Object.keys(filters).length ? { filters } : {}),
      ...(s.sort !== 'relevance' ? { sort: s.sort, dir: s.dir } : {}),
    };
  };
  const stop = () => {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  const noun = (n: number, more: boolean) =>
    `${n}${more ? '+' : ''} ${n === 1 && !more ? 'result' : 'results'}`;

  /** The index is unusable and core gave up: show why instead of "Rebuilding…" forever. */
  function indexFailed(message: string | undefined) {
    const m = message || 'The search index could not be rebuilt.';
    store.set({
      status: 'indexError',
      error: m,
      hits: [],
      hasMore: false,
      messages: [],
      progress: undefined,
      announce: `Search index error: ${m}`,
      index: { state: 'error', message: m },
    });
  }

  /** Settles a page into the store. `kind` decides the announcement. */
  function settle(page: SearchPage, hits: SearchHit[], kind: 'new' | 'refresh' | 'more') {
    const capped = hits.length >= MAX_ROWS;
    const more = !!cursor && !capped;
    const messages = capped
      ? [
          ...page.messages,
          `Showing the first ${MAX_ROWS} results. Refine your search to see others.`,
        ]
      : page.messages;
    if (page.state === 'error') return indexFailed(page.messages[0]);
    if (page.state === 'rebuilding') {
      store.set({
        status: 'rebuilding',
        hits: [],
        hasMore: false,
        messages,
        announce: 'Rebuilding the search index…',
        index: page.progress
          ? { state: 'rebuilding', progress: page.progress }
          : { state: 'rebuilding' },
        ...(page.progress ? { progress: page.progress } : {}),
      });
      // The ready event may have passed before this reply was handled: ask once.
      void client.call('search.status').then((st) => {
        if (!st.ok || store.get().status !== 'rebuilding') return;
        if (st.value.state === 'ready') {
          store.set({ index: { state: 'ready' } });
          run('new');
        } else if (st.value.state === 'error') indexFailed(st.value.message);
      });
      return;
    }
    const q = store.get().query.trim();
    store.set({
      status: 'ready',
      error: undefined,
      hits,
      hasMore: more,
      messages,
      index: { state: 'ready' },
      announce:
        kind === 'more'
          ? `${noun(hits.length, more)} loaded`
          : hits.length
            ? noun(hits.length, more)
            : `No notes match “${q}”`,
    });
  }

  function run(kind: 'new' | 'refresh'): void {
    stop();
    if (!active()) return reset();
    const mine = ++seq;
    const loaded = kind === 'refresh' ? store.get().hits.length : 0;
    if (kind === 'new') store.set({ status: 'loading' });
    void (async () => {
      const base = params();
      const hits: SearchHit[] = [];
      let cur: string | undefined;
      let last: SearchPage | undefined;
      do {
        const r = await client.call('search.run', {
          ...base,
          limit: kind === 'refresh' ? REFRESH_PAGE : PAGE,
          ...(cur ? { cursor: cur } : {}),
        });
        if (mine !== seq) return;
        if (!r.ok) {
          store.set({
            status: 'error',
            error: r.error.message,
            announce: `Search failed: ${r.error.message}`,
          });
          return;
        }
        last = r.value;
        hits.push(...r.value.hits);
        cur = r.value.nextCursor;
        // After the first page of a refresh, keep going until the loaded count is back.
      } while (kind === 'refresh' && cur && hits.length < loaded && last.state === 'ready');
      cursor = cur;
      settle(last, hits, kind);
    })();
  }

  function reset() {
    ++seq;
    cursor = undefined;
    store.set({
      status: 'idle',
      hits: [],
      hasMore: false,
      messages: [],
      error: undefined,
      announce: '',
    });
  }

  function schedule(kind: 'new' | 'refresh') {
    if (!active()) return (stop(), reset());
    pending = pending === 'new' || kind === 'new' ? 'new' : 'refresh';
    if (timer !== undefined) timers.clearTimeout(timer);
    if (kind === 'new') store.set({ status: 'loading' });
    timer = timers.setTimeout(() => run(pending ?? 'new'), DEBOUNCE_MS);
  }

  const self: SearchStore = {
    ...store,
    hooks: {},

    start() {
      offNav ??= nav.subscribe(() => {
        if (!applying && active()) run('new'); // M9: results follow the nav selection
      });
      void client.call('search.status').then((r) => {
        if (r.ok) store.set({ index: r.value });
      });
      void self.loadSaved();
    },
    dispose() {
      stop();
      ++seq;
      offNav?.();
      offNav = undefined;
    },

    setQuery(q) {
      store.set({ query: q });
      schedule('new');
    },
    setFilters(patch) {
      store.set((s) => ({ filters: { ...s.filters, ...patch } }));
      schedule('new');
    },
    setSort(sort, dir) {
      store.set((s) => ({ sort, dir: dir ?? s.dir }));
      schedule('new');
    },
    clear() {
      stop();
      store.set({ query: '', filters: NO_FILTERS, sort: 'relevance', dir: 'desc' });
      reset();
    },
    retry: () => run('new'),

    async rebuild() {
      const r = await client.call('search.rebuild');
      toasts.push({
        message: r.ok
          ? 'Rebuilding the search index…'
          : `Couldn’t rebuild the search index: ${r.error.message}`,
      });
      // Events drive progress and the end; a search re-run shows the current state at once.
      if (r.ok && store.get().status === 'indexError' && active()) run('new');
    },

    async loadMore() {
      const s = store.get();
      if (!cursor || s.status !== 'ready') return;
      const mine = ++seq;
      const r = await client.call('search.run', { ...params(), limit: PAGE, cursor });
      if (mine !== seq) return;
      if (!r.ok) return store.set({ status: 'error', error: r.error.message });
      cursor = r.value.nextCursor;
      const have = new Set(s.hits.map((h) => h.noteId));
      settle(r.value, [...s.hits, ...r.value.hits.filter((h) => !have.has(h.noteId))], 'more');
    },

    spec() {
      const { query, scope, filters, sort, dir } = params();
      return {
        query,
        ...(scope ? { scope } : {}),
        ...(filters ? { filters } : {}),
        ...(sort ? { sort, dir: dir! } : {}),
      };
    },
    apply(sv) {
      const sp = sv.spec;
      applying = true;
      try {
        nav.select(
          sp.scope
            ? { kind: sp.scope.kind, ...(sp.scope.id ? { id: sp.scope.id } : {}) }
            : { kind: 'all' },
        );
      } finally {
        applying = false;
      }
      store.set({
        query: sp.query,
        filters: fromCoreFilters(sp.filters, zone),
        sort: sp.sort ?? 'relevance',
        dir: sp.dir ?? 'desc',
      });
      run('new');
    },

    async loadSaved() {
      const r = await client.call('search.saved.list');
      store.set({
        saved: r.ok
          ? { status: 'ready', items: r.value }
          : {
              status: 'error',
              items: [],
              error: r.error.message,
              corrupt: r.error.code === 'corrupt',
            },
      });
    },

    async verify() {
      const r = await client.call('search.verify');
      toasts.push({
        message: !r.ok
          ? `Couldn’t check the search index: ${r.error.message}`
          : r.value.skipped
            ? 'Index is rebuilding; try again when it finishes'
            : r.value.ok
              ? 'The search index is healthy.'
              : 'The search index had problems. It is being rebuilt.',
      });
    },

    onEvent(e) {
      if (e.type === 'searchState') {
        const prev = store.get();
        const wasBusy =
          prev.status === 'rebuilding' || prev.status === 'indexError' || prev.index.state !== 'ready';
        if (e.state === 'error') {
          if (active()) indexFailed(e.message);
          else
            store.set({
              index: { state: 'error', message: e.message || 'The search index could not be rebuilt.' },
            });
          return;
        }
        store.set({
          index:
            e.state === 'rebuilding'
              ? e.progress
                ? { state: 'rebuilding', progress: e.progress }
                : { state: 'rebuilding' }
              : { state: e.state },
          ...(e.state === 'rebuilding' && e.progress ? { progress: e.progress } : {}),
          // A manual rebuild after a failure: the error gives way to the progress view.
          ...(e.state === 'rebuilding' && prev.status === 'indexError'
            ? { status: 'rebuilding' as const, error: undefined }
            : {}),
        });
        if (e.state === 'ready' && wasBusy && active()) run('new');
      } else if (e.type === 'changed') {
        // M8: own autosaves (content) never re-run the search; structural changes refetch.
        if (e.content || !active()) return;
        schedule('refresh');
      }
    },
  };
  return self;
}
