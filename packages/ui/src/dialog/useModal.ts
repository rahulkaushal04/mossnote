import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * The one modal helper (dialogs, palette, shortcut list). Focus goes to `initial` (default: the
 * first control) on mount and stays inside the returned `ref` element (Tab wraps, focus that
 * escapes is pulled back). Esc calls `onCancel` and is consumed, so lower-priority Esc handlers see
 * it handled. On close, focus returns to the opener unless a command already moved it elsewhere.
 */
export function useModal(onCancel: () => void, initial?: RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const opener = document.activeElement;
    const root = ref.current;
    const first = initial?.current ?? root?.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    first?.focus();
    const onFocusIn = (e: FocusEvent) => {
      if (root && e.target instanceof Node && !root.contains(e.target)) first?.focus();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      const a = document.activeElement;
      if (
        (!a || a === document.body || root?.contains(a)) &&
        opener instanceof HTMLElement &&
        opener.isConnected
      )
        opener.focus();
    };
  }, [initial]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel.current();
    } else if (e.key === 'Tab') {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
      e.preventDefault();
      items[next]?.focus();
    }
  };
  return { ref, onKeyDown };
}
