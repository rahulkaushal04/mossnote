import { useEffect, useRef } from 'react';
import { tinykeys } from 'tinykeys';
import { singleKeysEnabled } from './theme';

/** True when focus is somewhere a single-key shortcut must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.isContentEditable ||
    target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null
  );
}

/** True while a dialog or menu is open anywhere on the page. */
export const overlayOpen = (): boolean =>
  document.querySelector('[role="dialog"], [role="menu"], [role="alertdialog"]') !== null;

export type KeyHandler = (event: KeyboardEvent) => void;

/**
 * Wrap a single-key shortcut with these rules: inactive in inputs, while a
 * dialog or menu is open, when Ctrl, Cmd or Alt is held, and when the user turned single-key
 * shortcuts off. Shift is allowed only for characters that need it (`?`).
 */
export function singleKey(handler: KeyHandler, options: { allowShift?: boolean } = {}): KeyHandler {
  return (event) => {
    if (!singleKeysEnabled()) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.shiftKey && !options.allowShift) return;
    if (isTypingTarget(event.target) || overlayOpen()) return;
    handler(event);
  };
}

/**
 * Bind a map of tinykeys bindings to the window for as long as the component is mounted. The
 * latest handlers are always used, so callers can pass inline closures. Sequences such as
 * `g t` use a 1-second timeout.
 */
export function useHotkeys(bindings: Record<string, KeyHandler>): void {
  const latest = useRef(bindings);
  useEffect(() => {
    latest.current = bindings;
  });
  const keys = Object.keys(bindings).join('|');

  useEffect(() => {
    const map: Record<string, KeyHandler> = {};
    for (const key of keys.split('|')) {
      if (key) map[key] = (event) => latest.current[key]?.(event);
    }
    return tinykeys(window, map, { timeout: 1000 });
  }, [keys]);
}

/** `⌘` on macOS, `Ctrl` elsewhere, for hints. */
export const modLabel = (): string =>
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform) ? '⌘' : 'Ctrl';
