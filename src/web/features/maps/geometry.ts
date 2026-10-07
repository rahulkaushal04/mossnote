/**
 * View maths: converting between screen and map coordinates, panning, zooming and fitting.
 */
import type { Box, MPt } from './engine/vec';

export interface View {
  /** World point at the centre of the screen. */
  cx: number;
  cy: number;
  /** Screen pixels per world unit. */
  scale: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 24;
export const DEFAULT_VIEW: View = { cx: 0, cy: 0, scale: 1 };
/** Panning stops short of the edge of the storable area. */
export const WORLD_LIMIT = 90_000;

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export interface Size {
  w: number;
  h: number;
}

export const toWorld = (view: View, size: Size, sx: number, sy: number): MPt => [
  (sx - size.w / 2) / view.scale + view.cx,
  (sy - size.h / 2) / view.scale + view.cy,
];

export const toScreen = (view: View, size: Size, x: number, y: number): MPt => [
  (x - view.cx) * view.scale + size.w / 2,
  (y - view.cy) * view.scale + size.h / 2,
];

const clampCentre = (v: View): View => ({
  ...v,
  cx: Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, v.cx)),
  cy: Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, v.cy)),
});

export const panBy = (view: View, dxPx: number, dyPx: number): View =>
  clampCentre({ ...view, cx: view.cx - dxPx / view.scale, cy: view.cy - dyPx / view.scale });

/** Zoom by `factor` keeping the world point under the screen position fixed. */
export function zoomAt(view: View, size: Size, sx: number, sy: number, factor: number): View {
  const scale = clampScale(view.scale * factor);
  const [wx, wy] = toWorld(view, size, sx, sy);
  return clampCentre({
    scale,
    cx: wx - (sx - size.w / 2) / scale,
    cy: wy - (sy - size.h / 2) / scale,
  });
}

/** A view that shows `box` with a margin. An empty map shows the middle of the page. */
export function fitView(box: Box | null, size: Size, maxScale = 2): View {
  if (!box || size.w === 0 || size.h === 0) return DEFAULT_VIEW;
  const margin = 56;
  const w = Math.max(box.maxX - box.minX, 40);
  const h = Math.max(box.maxY - box.minY, 40);
  const scale = clampScale(
    Math.min((size.w - margin * 2) / w, (size.h - margin * 2) / h, maxScale),
  );
  return { scale, cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2 };
}

/** The part of the world on screen, as a box. */
export function visibleBox(view: View, size: Size): Box {
  const [minX, minY] = toWorld(view, size, 0, 0);
  const [maxX, maxY] = toWorld(view, size, size.w, size.h);
  return { minX, minY, maxX, maxY };
}

/** Keep a coordinate inside what the server accepts. */
export const clampCoord = (n: number, limit = 99_000): number =>
  Math.max(-limit, Math.min(limit, n));
