import { useEffect, type RefObject } from 'react';
import { useKeyboardInset } from './useKeyboardInset';

/**
 * Keeps a focused field in view when the on-screen keyboard opens, so the composer is never
 * hidden behind it. Does nothing for a field that is not focused or when there is no keyboard.
 */
export function useKeepInView(ref: RefObject<HTMLElement | null>): void {
  const inset = useKeyboardInset();
  useEffect(() => {
    const el = ref.current;
    if (inset > 0 && el && document.activeElement === el) el.scrollIntoView({ block: 'center' });
  }, [inset, ref]);
}
