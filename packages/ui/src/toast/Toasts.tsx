import { useEffect, useRef } from 'react';
import { useToasts, type Toast, type ToastStore } from './toastStore';

/** Where focus goes when the toast that held it disappears and its old spot is gone. */
const FALLBACK = ['[role=listbox] [tabindex="0"]', '[role=tree] [tabindex="0"]', 'main'];

function ToastItem(p: { t: Toast; store: ToastStore; onLeave(to: Element | null): void }) {
  const { t, store, onLeave } = p;
  const ref = useRef<HTMLDivElement>(null);
  const came = useRef<Element | null>(null);
  // Using or dismissing a toast removes the focused button; focus must not fall to <body>.
  const done = (fn: () => void) => () => {
    if (ref.current?.contains(document.activeElement)) onLeave(came.current);
    fn();
  };
  return (
    <div
      ref={ref}
      className="toast"
      role="group"
      aria-label={t.message}
      onMouseEnter={() => store.hold(t.id, 'hover')}
      onMouseLeave={() => store.release(t.id, 'hover')}
      onFocus={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          came.current = e.relatedTarget as Element | null;
        store.hold(t.id, 'focus');
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) store.release(t.id, 'focus');
      }}
    >
      <span>{t.message}</span>
      {t.onAction && t.actionLabel && (
        <button type="button" onClick={done(() => void store.runAction(t.id))}>
          {t.actionLabel}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={done(() => store.dismiss(t.id))}
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * The toast region (role=status, always mounted so screen readers announce additions). Mount once
 * in the shell. Toasts stack in order; the timer pauses while one is hovered or has focus. When a
 * focused toast goes away, focus returns to where it came from (or the list/tree/editor).
 */
export function Toasts({ store }: { store: ToastStore }) {
  const toasts = useToasts(store);
  const restore = useRef<{ to: Element | null } | null>(null);
  useEffect(() => {
    const r = restore.current;
    if (!r) return;
    restore.current = null;
    const a = document.activeElement;
    if (a && a !== document.body) return; // something already took focus
    const to = r.to?.isConnected
      ? r.to
      : FALLBACK.map((q) => document.querySelector(q)).find(Boolean);
    (to as HTMLElement | null | undefined)?.focus();
  }, [toasts]);
  return (
    <div role="status" aria-live="polite" aria-label="Notifications" className="toasts">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} store={store} onLeave={(to) => (restore.current = { to })} />
      ))}
    </div>
  );
}
