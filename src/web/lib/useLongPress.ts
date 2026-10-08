import { useRef, type MouseEvent, type PointerEvent } from 'react';

/** How long a finger must stay down before it counts as a long press (ms). */
export const LONG_PRESS_MS = 450;

/**
 * Handlers that call `onLong` when a finger rests on an element, so an icon-only control can
 * show its name on touch, where there is no hover. A mouse is ignored (it has tooltips). The
 * click that ends a long press is swallowed so the action does not also run.
 */
export function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);

  const cancel = () => {
    clearTimeout(timer.current);
  };

  return {
    onPointerDown(event: PointerEvent) {
      if (event.pointerType !== 'touch') return;
      fired.current = false;
      cancel();
      timer.current = setTimeout(() => {
        fired.current = true;
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClickCapture(event: MouseEvent) {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    // A long press opens the browser's context menu on some phones.
    onContextMenu(event: MouseEvent) {
      if (fired.current) event.preventDefault();
    },
  };
}
