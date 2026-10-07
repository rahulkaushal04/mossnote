/**
 * Small 2D vector and box helpers used across the map engine. `Pt` is read-only; `MPt` is the
 * mutable form.
 */
export type Pt = readonly [number, number];
export type MPt = [number, number];

export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const add = (a: Pt, b: Pt): MPt => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Pt, b: Pt): MPt => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Pt, k: number): MPt => [a[0] * k, a[1] * k];
export const mid = (a: Pt, b: Pt): MPt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const lerp = (a: Pt, b: Pt, t: number): MPt => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
export const angleOf = (a: Pt, b: Pt): number => Math.atan2(b[1] - a[1], b[0] - a[0]);
export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;

/** Rotate `p` about `c` by `angle` radians. */
export function rotateAbout(p: Pt, c: Pt, angle: number): MPt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const roundPt = (p: Pt): MPt => [round1(p[0]), round1(p[1])];

/** Closest point to `p` on the segment `a`-`b`, and its distance. */
export function nearestOnSegment(p: Pt, a: Pt, b: Pt): { pt: MPt; d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const pt: MPt = [a[0] + t * dx, a[1] + t * dy];
  return { pt, d: dist(p, pt), t };
}

export const pathLength = (pts: readonly Pt[]): number => {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1]!, pts[i]!);
  return total;
};

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boxOf(pts: readonly Pt[]): Box | null {
  let box: Box | null = null;
  for (const [x, y] of pts) {
    box = box
      ? {
          minX: Math.min(box.minX, x),
          minY: Math.min(box.minY, y),
          maxX: Math.max(box.maxX, x),
          maxY: Math.max(box.maxY, y),
        }
      : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return box;
}

export const unionBox = (a: Box | null, b: Box | null): Box | null =>
  !a
    ? b
    : !b
      ? a
      : {
          minX: Math.min(a.minX, b.minX),
          minY: Math.min(a.minY, b.minY),
          maxX: Math.max(a.maxX, b.maxX),
          maxY: Math.max(a.maxY, b.maxY),
        };

export const boxCenter = (b: Box): MPt => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
export const boxW = (b: Box): number => b.maxX - b.minX;
export const boxH = (b: Box): number => b.maxY - b.minY;
export const boxesIntersect = (a: Box, b: Box): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
export const boxContains = (outer: Box, inner: Box): boolean =>
  outer.minX <= inner.minX &&
  outer.maxX >= inner.maxX &&
  outer.minY <= inner.minY &&
  outer.maxY >= inner.maxY;
export const inflate = (b: Box, by: number): Box => ({
  minX: b.minX - by,
  minY: b.minY - by,
  maxX: b.maxX + by,
  maxY: b.maxY + by,
});
