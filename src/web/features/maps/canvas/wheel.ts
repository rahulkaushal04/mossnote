import type { WheelEvent } from 'react';
import { panBy, zoomAt, type Size, type View } from '../geometry';

/**
 * Decide what a wheel event means and return the new view. A mouse wheel, or a pinch (which
 * browsers report as Ctrl + wheel), zooms about the pointer; a trackpad scroll pans.
 */
export function viewAfterWheel(
  view: View,
  size: Size,
  e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'metaKey'>,
  pointer: { x: number; y: number },
): View {
  const isMouseWheel =
    e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
  if (e.ctrlKey || e.metaKey || isMouseWheel) {
    const sensitivity = e.ctrlKey ? 0.01 : isMouseWheel ? 0.0016 : 0.004;
    return zoomAt(view, size, pointer.x, pointer.y, Math.exp(-e.deltaY * sensitivity));
  }
  return panBy(view, -e.deltaX, -e.deltaY);
}
