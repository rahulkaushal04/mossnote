import type { Box } from '../engine/vec';
import type { Size, View } from '../geometry';

/** Keep the quick bar this far (px) from the left and right of the canvas. */
const QUICK_BAR_HALF_WIDTH = 110;
/** The quick bar sits this far (px) above the selection, clearing the turn handle. */
const QUICK_BAR_RISE = 84;

/** Where the quick bar floats: centred above the selection, kept inside the canvas. */
export function quickBarPosition(selection: Box, view: View, size: Size): { x: number; y: number } {
  const centreX = ((selection.minX + selection.maxX) / 2 - view.cx) * view.scale + size.w / 2;
  return {
    x: Math.max(QUICK_BAR_HALF_WIDTH, Math.min(size.w - QUICK_BAR_HALF_WIDTH, centreX)),
    y: Math.max(8, (selection.minY - view.cy) * view.scale + size.h / 2 - QUICK_BAR_RISE),
  };
}
