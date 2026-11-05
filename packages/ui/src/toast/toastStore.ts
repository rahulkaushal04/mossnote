import { createStore, useStore, type Store } from '../app/store';

export const TOAST_MS = 10_000;

export interface ToastInput {
  message: string;
  /** With `onAction`, the toast shows this button (e.g. "Undo delete"). */
  actionLabel?: string;
  onAction?(): void | Promise<void>;
  /** Default 10 000 ms. */
  lifetimeMs?: number;
}
export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}
export interface ToastState {
  toasts: Toast[];
}
export interface ToastStore extends Store<ToastState> {
  push(t: ToastInput): number;
  dismiss(id: number): void;
  /** The lifetime clock stops while any holder ('hover', 'focus', ...) holds the toast. */
  hold(id: number, who: string): void;
  release(id: number, who: string): void;
  /** Dismisses the toast, then runs its action (so a second click cannot run it twice). */
  runAction(id: number): Promise<void>;
  /** Runs the newest toast that has an action (the `trash.undo` command). False if none. */
  undoLatest(): Promise<boolean>;
}
export interface ToastDeps {
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
  now?: () => number;
}

export function createToastStore(deps: ToastDeps = {}): ToastStore {
  // Resolved at call time so fake timers installed later still apply.
  const timers = deps.timers ?? {
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const now = deps.now ?? (() => Date.now());
  const store = createStore<ToastState>({ toasts: [] });
  const live = new Map<
    number,
    { remaining: number; startedAt: number; handle: unknown; holds: Set<string> }
  >();
  let next = 1;

  const stop = (id: number) => {
    const t = live.get(id);
    if (t?.handle !== undefined) {
      timers.clearTimeout(t.handle);
      t.remaining = Math.max(0, t.remaining - (now() - t.startedAt));
      t.handle = undefined;
    }
  };
  const start = (id: number) => {
    const t = live.get(id);
    if (!t || t.handle !== undefined) return;
    t.startedAt = now();
    t.handle = timers.setTimeout(() => api.dismiss(id), t.remaining);
  };
  const api: ToastStore = {
    ...store,
    push(t) {
      const id = next++;
      live.set(id, {
        remaining: t.lifetimeMs ?? TOAST_MS,
        startedAt: 0,
        handle: undefined,
        holds: new Set(),
      });
      store.set((s) => ({
        toasts: [
          ...s.toasts,
          { id, message: t.message, actionLabel: t.actionLabel, onAction: t.onAction },
        ],
      }));
      start(id);
      return id;
    },
    dismiss(id) {
      stop(id);
      live.delete(id);
      store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    hold(id, who) {
      const t = live.get(id);
      if (!t) return;
      t.holds.add(who);
      stop(id);
    },
    release(id, who) {
      const t = live.get(id);
      if (!t) return;
      t.holds.delete(who);
      if (t.holds.size === 0) start(id);
    },
    async runAction(id) {
      const t = store.get().toasts.find((x) => x.id === id);
      if (!t) return;
      api.dismiss(id);
      await t.onAction?.();
    },
    async undoLatest() {
      const t = [...store.get().toasts].reverse().find((x) => x.onAction);
      if (!t) return false;
      await api.runAction(t.id);
      return true;
    },
  };
  return api;
}

/** The toasts, newest last. */
export function useToasts(store: ToastStore): Toast[] {
  return useStore(store, (s) => s.toasts);
}
