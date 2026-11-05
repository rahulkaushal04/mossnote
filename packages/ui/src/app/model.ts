import type {
  Bridge,
  NoteSummary,
  Prefs,
  RecoverableDraft,
  RpcEvent,
  SaveReply,
} from '@mossnote/core/rpc';
import type { SaveState, Timers } from '../editor/autosave';
import type { PanelApi } from '../attachments/AttachmentsPanel';
import { createClient, type Client } from '../rpc/client';
import { createNavStore, selectionToListArgs, type NavStore } from '../nav/navStore';
import { applyTheme, type ThemeMode } from '../theme/applyTheme';
import { createToastStore, type ToastStore } from '../toast/toastStore';
import { createTrashActions, type TrashActions } from '../trash/trashActions';
import { createSearchStore, type SearchStore } from '../search/searchStore';
import { createStore, type Store } from './store';

export const PAGE = 500;

export interface Recovered {
  draft: RecoverableDraft;
  title: string;
}
export interface ModelState {
  boot: 'loading' | 'ready' | 'fatal';
  fatal?: string;
  prefs?: Prefs;
  notes: NoteSummary[];
  list: 'loading' | 'ready' | 'error';
  listError?: string;
  hasMore: boolean;
  openId: string | null;
  save: SaveState;
  /** Notes whose text lives only in the drafts journal: noteId -> title. */
  unsaved: Record<string, string>;
  recovered: Recovered[];
  /** Distraction-free mode: nav, list, toolbar and status bar are hidden (the editor stays mounted). */
  focusMode: boolean;
}

export const firstLine = (text: string): string =>
  (text.split(/\r\n|\r|\n/).find((l) => l.trim()) ?? '').replace(/^[#\s]+/, '').slice(0, 80);

export interface AppDeps {
  bridge: Bridge;
  timers?: Timers;
}
export interface AppModel {
  store: Store<ModelState>;
  client: Client;
  timers: Timers;
  nav: NavStore;
  search: SearchStore;
  toasts: ToastStore;
  /** Delete = move to Trash + Undo toast. */
  actions: TrashActions;
  /** Set by the mounted EditorPane. */
  hooks: {
    flush?: () => Promise<void>;
    focusEditor?: () => void;
    retry?: () => void;
    /** True when a format command could change the open note. */
    canFormat?: () => boolean;
    runFormat?: (id: string) => boolean;
    /** A draftError event; true when the open note's machine took it. */
    draftError?: (noteId: string, message: string) => boolean;
    /** Drops the journal of the note in the editor like "Use saved version"; false when that note is not loaded. */
    discardLoaded?: (noteId: string) => Promise<boolean>;
    /** Inserts text at the cursor of the open, editable note; false when it cannot. */
    insertText?: (text: string) => boolean;
    /** The attachments panel of the open note (drop, paste, picker); undefined when no note is open. */
    attach?: PanelApi;
  };
  start(): Promise<void>;
  refreshList(): Promise<void>;
  loadMore(): Promise<void>;
  createNote(body?: string): Promise<void>;
  openNote(id: string | null): void;
  setTheme(mode: ThemeMode): Promise<void>;
  toggleFocusMode(): void;
  patchRow(id: string, r: SaveReply): void;
  markUnsaved(id: string, title: string): void;
  clearUnsaved(id: string): void;
  restoreDraft(d: RecoverableDraft): Promise<void>;
  discardDraft(d: RecoverableDraft): Promise<void>;
  dismissRecovered(): void;
  flushForQuit(token: string): Promise<void>;
  dispose(): void;
}

const systemTimers: Timers = {
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createModel({ bridge, timers = systemTimers }: AppDeps): AppModel {
  const client = createClient(bridge);
  const store = createStore<ModelState>({
    boot: 'loading',
    notes: [],
    list: 'loading',
    hasMore: false,
    openId: null,
    save: { kind: 'saved' },
    unsaved: {},
    recovered: [],
    focusMode: false,
  });
  const nav = createNavStore();
  const toasts = createToastStore({ timers });
  const search = createSearchStore({ client, nav, timers, toasts });
  const hooks: AppModel['hooks'] = {};
  let refreshing: Promise<void> | undefined;
  let refreshAgain = false;
  let disposed = false;
  const actions = createTrashActions({
    client,
    toasts,
    // The pending save lands first, so the trashed note keeps what the user typed.
    beforeTrash: () => hooks.flush?.(),
    onTrashed: (entity, id) => {
      if (entity === 'note' && store.get().openId === id) model.openNote(null);
    },
  });

  async function fetchPage(
    limit: number,
    cursor?: { updatedAt: number; id: string },
  ): Promise<NoteSummary[] | string> {
    const r = await client.call('notes.list', {
      ...selectionToListArgs(nav.get()),
      limit,
      ...(cursor ? { cursor } : {}),
    });
    return r.ok ? r.value : r.error.message;
  }

  const model: AppModel = {
    store,
    client,
    timers,
    nav,
    search,
    toasts,
    actions,
    hooks,

    async start() {
      arm(); // a StrictMode remount disposes the model between two starts
      const st = await client.call('app.status');
      if (!st.ok || st.value.state === 'error') {
        const msg = st.ok
          ? (st.value.message ?? 'The workspace could not be opened.')
          : st.error.message;
        return store.set({ boot: 'fatal', fatal: msg });
      }
      const p = await client.call('prefs.get');
      // Theme first, so the shell's very first paint already has the saved colors.
      if (p.ok) applyTheme(p.value.theme);
      store.set({ boot: 'ready', ...(p.ok ? { prefs: p.value } : {}) });
      void model.refreshList();
      search.start();
      await client.call('drafts.flush', {}); // recover must see every journaled row
      const d = await client.call('drafts.recover');
      if (!d.ok) return;
      const recovered: Recovered[] = [];
      const unsaved: Record<string, string> = {};
      for (const draft of d.value) {
        if (draft.matchesNote) {
          // The journal row equals the saved note: nothing to recover.
          await client.call('drafts.discard', { noteId: draft.noteId, upToSeq: draft.seq });
        } else {
          const title = firstLine(draft.body) || 'Untitled';
          recovered.push({ draft, title });
          unsaved[draft.noteId] = title;
        }
      }
      store.set({ recovered, unsaved });
    },

    refreshList() {
      // Coalesce: one fetch at a time; events that arrive meanwhile cause exactly one more.
      if (refreshing) {
        refreshAgain = true;
        return refreshing;
      }
      refreshing = (async () => {
        try {
          do {
            refreshAgain = false;
            const loaded = store.get().notes.length;
            const sel = nav.get();
            const res = await fetchPage(Math.max(PAGE, loaded));
            if (disposed) return;
            if (nav.get() !== sel) continue; // the selection moved on; its own refresh follows
            if (typeof res === 'string') store.set({ list: 'error', listError: res });
            else
              store.set({
                list: 'ready',
                notes: res,
                hasMore: res.length >= Math.max(PAGE, loaded),
              });
          } while (refreshAgain);
        } finally {
          refreshing = undefined;
        }
      })();
      return refreshing;
    },

    async loadMore() {
      const { notes } = store.get();
      const last = notes[notes.length - 1];
      if (!last) return;
      const res = await fetchPage(PAGE, { updatedAt: last.updatedAt, id: last.id });
      if (typeof res === 'string') return store.set({ list: 'error', listError: res });
      store.set((s) => ({ notes: [...s.notes, ...res], hasMore: res.length >= PAGE }));
    },

    async createNote(body) {
      const sel = nav.get();
      const r = await client.call('notes.create', {
        ...(sel.kind === 'folder' && sel.id ? { folderId: sel.id } : {}),
        ...(body ? { body } : {}),
      });
      if (!r.ok) return store.set({ list: 'error', listError: r.error.message });
      model.openNote(r.value.id);
      void model.refreshList();
    },

    openNote: (id) => store.set({ openId: id }),

    async setTheme(mode) {
      const r = await client.call('prefs.set', { theme: mode });
      if (!r.ok)
        return void toasts.push({ message: `Couldn’t save the theme: ${r.error.message}` });
      applyTheme(r.value.theme);
      store.set({ prefs: r.value });
    },
    toggleFocusMode: () => store.set((s) => ({ focusMode: !s.focusMode })),

    // Own autosaves patch the single row from the reply; the list is never refetched for them.
    patchRow(id, r) {
      store.set((s) => ({
        notes: s.notes.map((n) => (n.id === id ? { ...n, ...r } : n)),
      }));
    },
    markUnsaved: (id, title) => store.set((s) => ({ unsaved: { ...s.unsaved, [id]: title } })),
    clearUnsaved(id) {
      // The note's text is saved or dropped, so its recovery prompt entry is stale too.
      if (!(id in store.get().unsaved) && !store.get().recovered.some((r) => r.draft.noteId === id))
        return;
      store.set((s) => {
        const rest = { ...s.unsaved };
        delete rest[id];
        return { unsaved: rest, recovered: s.recovered.filter((r) => r.draft.noteId !== id) };
      });
    },

    async restoreDraft(d) {
      const drop = () =>
        store.set((s) => ({ recovered: s.recovered.filter((r) => r.draft.seq !== d.seq) }));
      if (!d.baseChanged) {
        drop();
        return model.openNote(d.noteId); // opening loads the journal text; the first edit saves it
      }
      // The note moved on (or was trashed): never overwrite it, keep the text as a new note beside it.
      const orig = await client.call('notes.get', { id: d.noteId });
      const folderId = orig.ok ? orig.value.folderId : null;
      const c = await client.call('notes.create', {
        body: d.body,
        ...(folderId ? { folderId } : {}),
      });
      if (!c.ok) return;
      await client.call('drafts.discard', { noteId: d.noteId, upToSeq: d.seq });
      drop();
      model.clearUnsaved(d.noteId);
      model.openNote(c.value.id);
      void model.refreshList();
    },
    async discardDraft(d) {
      // On the open note the newer typing must not be saved over it: same steps as "Use saved version".
      if (!(await hooks.discardLoaded?.(d.noteId))) {
        const r = await client.call('drafts.discard', { noteId: d.noteId, upToSeq: d.seq });
        if (!r.ok) return;
      }
      store.set((s) => ({ recovered: s.recovered.filter((x) => x.draft.seq !== d.seq) }));
      model.clearUnsaved(d.noteId);
    },
    dismissRecovered: () => store.set({ recovered: [] }),

    async flushForQuit(token) {
      await hooks.flush?.();
      await client.call('app.flushed', { token });
    },

    dispose() {
      disposed = true;
      search.dispose();
      offNav?.();
      offNav = undefined;
    },
  };

  let offNav: (() => void) | undefined;
  function arm() {
    disposed = false;
    offNav ??= nav.subscribe(() => void model.refreshList());
  }
  arm();
  return model;
}

/** Wires bridge events to the model. Returns the unsubscribe. */
export function attachEvents(model: AppModel, onCommand?: (id: string) => void): () => void {
  return model.client.onEvent((e: RpcEvent) => {
    model.search.onEvent(e);
    if (e.type === 'changed') {
      // An own autosave (content) is handled by patchRow; tags do not change the list.
      if (e.content || e.entity === 'tag' || e.entity === 'attachment') return;
      void model.refreshList();
    } else if (e.type === 'command') {
      onCommand?.(e.id);
    } else if (e.type === 'status') {
      model.toasts.push({ message: e.message, lifetimeMs: e.level === 'warn' ? 15_000 : 6000 });
    } else if (e.type === 'draftError') {
      if (!model.hooks.draftError?.(e.noteId, e.message)) {
        // Not the open note: flag that note, never the open note's save status.
        const title = model.store.get().notes.find((n) => n.id === e.noteId)?.title || 'Untitled';
        model.markUnsaved(e.noteId, title);
        model.toasts.push({ message: `Couldn’t keep a copy of “${title}”: ${e.message}` });
      }
    } else if (e.type === 'flushRequest') {
      void model.flushForQuit(e.token);
    }
  });
}
