/**
 * Measuring: polygon area and outline length, in map units.
 */
import { dist, pathLength, type Pt } from './vec';

/** Area of a simple polygon in square world units (shoelace formula). */
export function polygonArea(pts: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

/** Length of a polygon's outline, or of an open path. */
export const outlineLength = (pts: readonly Pt[], closed: boolean): number =>
  pathLength(pts) + (closed && pts.length > 2 ? dist(pts[pts.length - 1]!, pts[0]!) : 0);
