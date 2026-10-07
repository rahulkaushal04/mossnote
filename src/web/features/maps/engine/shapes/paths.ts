import { mid, type MPt, type Pt } from '../vec';
import { connectorGeometry } from './connectors';
import type { ObjInfo, Objects } from './types';

/** A smooth curve through the points (Catmull-Rom as cubic Béziers). */
export function smoothPathD(pts: readonly Pt[], closed: boolean): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0]?.[0]} ${pts[0]?.[1]} l0.01 0`;
  if (n === 2 && !closed) return `M${pts[0]?.[0]} ${pts[0]?.[1]} L${pts[1]?.[0]} ${pts[1]?.[1]}`;
  // Points past either end repeat the end point (open) or wrap round (closed).
  const at = (i: number): Pt => {
    const idx = closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i));
    return pts[idx]!;
  };
  let d = `M${at(0)[0]} ${at(0)[1]}`;
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: MPt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: MPt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return closed ? `${d} Z` : d;
}

export function polylineD(pts: readonly Pt[], closed: boolean): string {
  if (pts.length === 0) return '';
  const body = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ');
  return closed ? `${body} Z` : body;
}

/** The straight pieces of a shape's outline, for snapping to its edges. */
export function outlineSegments(info: ObjInfo, objs: Objects): [Pt, Pt][] {
  const shape = info.shape;
  if (!shape) return [];
  if (shape.t === 'path' || shape.t === 'polygon') {
    const pts = shape.pts;
    const segments: [Pt, Pt][] = [];
    for (let i = 1; i < pts.length; i++) segments.push([pts[i - 1] as Pt, pts[i] as Pt]);
    if ((shape.t === 'polygon' || shape.closed) && pts.length > 2) {
      segments.push([pts[pts.length - 1] as Pt, pts[0] as Pt]);
    }
    return segments;
  }
  if (shape.t === 'connector') {
    const geometry = connectorGeometry(shape, objs);
    return geometry.pts.slice(1).map((p, i) => [geometry.pts[i] as Pt, p]);
  }
  if (info.corners) {
    const c = info.corners;
    return [
      [c[0] as Pt, c[1] as Pt],
      [c[1] as Pt, c[2] as Pt],
      [c[2] as Pt, c[3] as Pt],
      [c[3] as Pt, c[0] as Pt],
    ];
  }
  return [];
}

/** Points other drawing can snap to: ends, corners, edge midpoints, centres. */
export function anchorPoints(info: ObjInfo, objs: Objects): MPt[] {
  const shape = info.shape;
  if (info.kind === 'pin') return [info.center];
  if (!shape) return [];
  switch (shape.t) {
    case 'path': {
      const first = shape.pts[0];
      const last = shape.pts[shape.pts.length - 1];
      return first && last
        ? [
            [first[0], first[1]],
            [last[0], last[1]],
          ]
        : [];
    }
    case 'polygon':
      return shape.pts.map((p): MPt => [p[0], p[1]]);
    case 'connector': {
      const geometry = connectorGeometry(shape, objs);
      return [geometry.start.pt, geometry.end.pt];
    }
    default: {
      const corners = info.corners ?? [];
      const edgeMidpoints = corners.map((p, i) => mid(p, corners[(i + 1) % corners.length] as Pt));
      return [info.center, ...corners, ...edgeMidpoints];
    }
  }
}
