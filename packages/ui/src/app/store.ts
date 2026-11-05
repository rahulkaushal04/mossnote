import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(cb: () => void): () => void;
}

/** A tiny external store: `set` merges a patch and notifies only when something actually changed. */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      const keys = Object.keys(p) as (keyof T)[];
      if (keys.every((k) => Object.is(state[k], p[k]))) return;
      state = { ...state, ...p };
      for (const s of [...subs]) s();
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/** The selector must return a stable value (a field, not a fresh object) or React re-renders forever. */
export function useStore<T, S>(store: Store<T>, select: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
