import { useSyncExternalStore } from 'react';

/** Below this, a change in the visible height is browser chrome moving, not a keyboard (px). */
const KEYBOARD_MIN = 100;

function subscribe(listener: () => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  viewport.addEventListener('resize', listener);
  viewport.addEventListener('scroll', listener);
  return () => {
    viewport.removeEventListener('resize', listener);
    viewport.removeEventListener('scroll', listener);
  };
}

function read(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  const covered = Math.round(window.innerHeight - viewport.height - viewport.offsetTop);
  return covered >= KEYBOARD_MIN ? covered : 0;
}

/**
 * How many pixels of the bottom of the window the on-screen keyboard covers, or 0 when it is
 * closed (or there is no visual viewport). Fixed bars at the bottom sit under the keyboard on
 * some browsers, so the shell hides its tab bar while this is above 0.
 */
export const useKeyboardInset = (): number => useSyncExternalStore(subscribe, read, () => 0);
