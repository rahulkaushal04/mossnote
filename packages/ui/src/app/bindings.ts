import type { FolderTreeHandle } from '../nav/FolderTree';
import type { Registry } from '../commands/registry';
import { verifySummary } from '../attachments/types';
import type { AppModel } from './model';

export interface UiActions {
  tree(): FolderTreeHandle | null;
  togglePalette(): void;
  toggleShortcuts(): void;
  toggleNav(): void;
  openCleanup(): void;
}

const FORMATS = [
  'format.bold',
  'format.italic',
  'format.link',
  'format.bullet',
  'format.heading',
  'format.task',
] as const;

/**
 * Binds every command handler. Handlers read live state when they run, so this is bound once.
 * `enabled` hides a command from the palette and blocks its shortcut (format.* only while an
 * editable note is open). Returns the unbind function.
 */
export function bindCommands(r: Registry, model: AppModel, ui: UiActions): () => void {
  const { client, nav, toasts, hooks, store } = model;
  const open = () => store.get().openId;
  const hasOpen = { enabled: () => open() !== null };
  const offs = [
    r.bind('note.new', () => void model.createNote()),
    r.bind('folder.new', () => void ui.tree()?.newFolder(), { enabled: () => !!ui.tree() }),
    r.bind('folder.rename', () => ui.tree()?.renameSelected(), { enabled: () => !!ui.tree() }),
    r.bind('nav.all', () => nav.select({ kind: 'all' })),
    r.bind('nav.favorites', () => nav.select({ kind: 'favorites' })),
    r.bind('nav.trash', () => nav.select({ kind: 'trash' })),
    r.bind('capture.open', () => void client.call('app.openCapture')),
    r.bind(
      'note.trash',
      () => {
        const id = open();
        if (id)
          void model.actions.deleteNote(id, store.get().notes.find((n) => n.id === id)?.title);
      },
      hasOpen,
    ),
    r.bind(
      'note.favorite',
      () => {
        const id = open();
        if (!id) return;
        void (async () => {
          const n = await client.call('notes.get', { id });
          const done = n.ok
            ? await client.call('notes.setFavorite', { id, favorite: !n.value.favorite })
            : n;
          if (!done.ok) toasts.push({ message: `Couldn’t change favorite: ${done.error.message}` });
        })();
      },
      hasOpen,
    ),
    r.bind('trash.undo', () => void toasts.undoLatest(), {
      enabled: () => toasts.get().toasts.some((t) => t.onAction),
    }),
    r.bind('search.focus', () => model.search.hooks.focusInput?.(), {
      enabled: () => !store.get().focusMode,
    }),
    r.bind('search.verify', () => void model.search.verify()),
    r.bind('search.rebuild', () => void model.search.rebuild()),
    r.bind('attachments.add', () => hooks.attach?.pick(), {
      enabled: () => !!hooks.attach?.canAttach(),
    }),
    r.bind('attachments.cleanup', ui.openCleanup),
    r.bind('attachments.verify', () => {
      void (async () => {
        const v = await client.call('attachments.verifyAll');
        if (!v.ok)
          return void toasts.push({ message: `Couldn’t verify attachments: ${v.error.message}` });
        const bad = v.value.missing.length + v.value.corrupt.length > 0;
        toasts.push({ message: verifySummary(v.value), lifetimeMs: bad ? 15_000 : 6000 });
      })();
    }),
    r.bind('view.palette', ui.togglePalette),
    r.bind('view.shortcuts', ui.toggleShortcuts),
    r.bind('view.toggleNav', ui.toggleNav),
    r.bind('view.focusMode', () => {
      model.toggleFocusMode();
      // Hiding the pane that had focus would drop it to <body>; the editor is where the user wants to be.
      if (store.get().focusMode) hooks.focusEditor?.();
    }),
    r.bind('theme.light', () => void model.setTheme('light')),
    r.bind('theme.dark', () => void model.setTheme('dark')),
    r.bind('theme.system', () => void model.setTheme('system')),
    ...FORMATS.map((id) =>
      r.bind(id, () => void hooks.runFormat?.(id), { enabled: () => !!hooks.canFormat?.() }),
    ),
  ];
  return () => offs.forEach((off) => off());
}
