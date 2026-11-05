import { createStore, type Store } from '../app/store';
import { MAX_BULK_SELECT } from './summary';

export interface SelectionState {
  on: boolean;
  ids: ReadonlySet<string>;
  anchor: string | null;
  /** True when the 10,000 limit stopped an add. */
  capped: boolean;
}
export interface SelectionStore extends Store<SelectionState> {
  /** Set by the mounted BulkBar: the ids of the list or results in view, and where focus goes after an action. */
  hooks: { visible?: () => string[]; focus?: () => void };
  enter(): void;
  exit(): void;
  clear(): void;
  toggle(id: string): void;
  /** Adds the range between the anchor (or `from`) and `id`, in view order. */
  extend(order: readonly string[], id: string, from?: string): void;
  selectAll(order: readonly string[]): void;
  /** Drops ids that are no longer in view. */
  prune(order: readonly string[]): void;
}

export function rangeIds(order: readonly string[], a: string, b: string): string[] {
  const j = order.indexOf(b);
  const i = order.indexOf(a);
  if (j < 0) return [];
  if (i < 0) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

function addCapped(cur: ReadonlySet<string>, add: readonly string[]) {
  const ids = new Set(cur);
  let capped = false;
  for (const id of add) {
    if (ids.has(id)) continue;
    if (ids.size >= MAX_BULK_SELECT) capped = true;
    else ids.add(id);
  }
  return { ids, capped };
}

export function createSelection(): SelectionStore {
  const store = createStore<SelectionState>({
    on: false,
    ids: new Set(),
    anchor: null,
    capped: false,
  });
  const empty = { ids: new Set<string>(), anchor: null, capped: false };
  return {
    ...store,
    hooks: {},
    enter: () => store.set({ on: true }),
    exit: () => store.set({ on: false, ...empty }),
    clear: () => store.set({ ...empty }),
    toggle(id) {
      const s = store.get();
      if (s.ids.has(id)) {
        const ids = new Set(s.ids);
        ids.delete(id);
        return store.set({ ids, anchor: id, capped: false });
      }
      const r = addCapped(s.ids, [id]);
      store.set({ ids: r.ids, anchor: id, capped: r.capped });
    },
    extend(order, id, from) {
      const s = store.get();
      const a = s.anchor ?? from ?? id;
      const r = addCapped(s.ids, rangeIds(order, a, id));
      store.set({ ids: r.ids, anchor: a, capped: r.capped });
    },
    selectAll(order) {
      store.set({
        ids: new Set(order.slice(0, MAX_BULK_SELECT)),
        anchor: null,
        capped: order.length > MAX_BULK_SELECT,
      });
    },
    prune(order) {
      const s = store.get();
      const keep = new Set(order);
      let drop = false;
      for (const id of s.ids)
        if (!keep.has(id)) {
          drop = true;
          break;
        }
      if (drop) store.set({ ids: new Set([...s.ids].filter((id) => keep.has(id))) });
    },
  };
}

interface Mods {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}
/** True when the click was a selection gesture (the caller then must not open the note). */
export function selectionClick(
  sel: SelectionStore,
  order: readonly string[],
  id: string,
  e: Mods,
): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (!sel.get().on && !e.shiftKey && !mod) return false;
  sel.enter();
  if (e.shiftKey) sel.extend(order, id);
  else sel.toggle(id);
  return true;
}

/** Keys while selecting. null: not handled. `moveTo`: focus that row. */
export function selectionKey(
  sel: SelectionStore,
  order: readonly string[],
  active: string | undefined,
  target: string | null,
  e: Mods & { key: string },
): { moveTo?: string } | null {
  if (!sel.get().on) return null;
  const id = target ?? active;
  if (e.key === ' ' && id) {
    sel.toggle(id);
    return {};
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    sel.selectAll(order);
    return {};
  }
  if (e.key === 'Escape') {
    sel.exit();
    return {};
  }
  if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && active) {
    const i = order.indexOf(active);
    const next =
      order[Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return null;
    sel.extend(order, next, active);
    return { moveTo: next };
  }
  return null;
}
