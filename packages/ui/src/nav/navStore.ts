import type { Args } from '@mossnote/core/rpc';
import { createStore, type Store } from '../app/store';

export type NavKind = 'all' | 'favorites' | 'tag' | 'trash' | 'folder';
/** `id` is the folder id (kind 'folder') or tag id (kind 'tag'); absent otherwise. */
export interface NavSelection {
  kind: NavKind;
  id?: string;
}
export interface NavStore extends Store<NavSelection> {
  /** Replaces the whole selection (a plain `set` would keep a stale `id`). */
  select(sel: NavSelection): void;
}

export function createNavStore(initial: NavSelection = { kind: 'all' }): NavStore {
  const store = createStore<NavSelection>({ ...initial });
  return { ...store, select: (sel) => store.set({ kind: sel.kind, id: sel.id }) };
}

/** The `notes.list` arguments for a selection. `limit`/`cursor` are the caller's (paging). */
export function selectionToListArgs(sel: NavSelection): Args<'notes.list'> {
  switch (sel.kind) {
    case 'favorites':
      return { favorite: true };
    case 'trash':
      return { trashed: true };
    case 'tag':
      return sel.id ? { tagId: sel.id } : {};
    case 'folder':
      return sel.id ? { folderId: sel.id } : {};
    default:
      return {};
  }
}
