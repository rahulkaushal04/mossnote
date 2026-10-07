/**
 * Snapping: turn a raw pointer position or box into the nearest useful one, and report the guides
 * to draw. Order of preference is points, then edges, then align and angle, then grid. Pure; no
 * DOM.
 */
import { nearestOnSegment, rad, deg, dist, type Box, type MPt, type Pt } from './vec';

export interface SnapSettings {
  /** Ends, corners and centres of other objects, and points along their edges. */
  objects: boolean;
  /** Edges and centres lining up with other objects, and guides. */
  align: boolean;
  grid: boolean;
  /** Lines and arrows lock to 15 degree steps. */
  angle: boolean;
}

export const ALL_SNAPS: SnapSettings = { objects: true, align: true, grid: true, angle: true };

export interface Guide {
  axis: 'x' | 'y';
  pos: number;
  /** Extent along the other axis, for drawing the guide line. */
  from: number;
  to: number;
}

export interface SnapContext {
  /** Screen pixels per world unit. */
  scale: number;
  settings: SnapSettings;
  gridStep: number;
  points: { pt: MPt; id: string }[];
  segments: { a: Pt; b: Pt; id: string }[];
  lines: { axis: 'x' | 'y'; pos: number }[];
}

export interface SnapResult {
  pt: MPt;
  kind: 'point' | 'edge' | 'align' | 'angle' | 'grid' | 'none';
  /** The object snapped to, for attaching a connector. */
  id?: string;
  guides: Guide[];
}

const POINT_PX = 12;
const EDGE_PX = 9;
const ALIGN_PX = 6;
const GRID_PX = 7;
const ANGLE_STEP = 15;
const ANGLE_TOLERANCE = 5;

/** A grid step that keeps cells a comfortable size on screen at any zoom. */
export function gridStep(scale: number): number {
  const steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  return steps.find((s) => s * scale >= 14) ?? 10000;
}

const nearestLine = (v: number, lines: SnapContext['lines'], axis: 'x' | 'y', within: number) => {
  let best: number | null = null;
  let bestD = within;
  for (const l of lines) {
    if (l.axis !== axis) continue;
    const d = Math.abs(l.pos - v);
    if (d <= bestD) {
      bestD = d;
      best = l.pos;
    }
  }
  return best;
};

const guideFor = (
  axis: 'x' | 'y',
  pos: number,
  other: number,
  lines: SnapContext['points'],
): Guide => {
  let from = other;
  let to = other;
  for (const p of lines) {
    const v = axis === 'x' ? p.pt[1] : p.pt[0];
    from = Math.min(from, v);
    to = Math.max(to, v);
  }
  return { axis, pos, from: from - 20, to: to + 20 };
};

/**
 * Snap one point. Order of preference: another object's point, then its edge, then alignment and
 * angle, then the grid. Each only reaches a few pixels, so nothing feels sticky.
 */
export function snapPoint(
  p: Pt,
  ctx: SnapContext,
  options: { from?: Pt | undefined; constrain?: boolean | undefined } = {},
): SnapResult {
  const px = (n: number) => n / ctx.scale;
  const s = ctx.settings;
  if (s.objects) {
    let best: { pt: MPt; id: string; d: number } | null = null;
    for (const c of ctx.points) {
      const d = dist(p, c.pt);
      if (d <= px(POINT_PX) && (!best || d < best.d)) best = { ...c, d };
    }
    if (best) return { pt: [best.pt[0], best.pt[1]], kind: 'point', id: best.id, guides: [] };
    let edge: { pt: MPt; id: string; d: number } | null = null;
    for (const seg of ctx.segments) {
      const n = nearestOnSegment(p, seg.a, seg.b);
      if (n.d <= px(EDGE_PX) && (!edge || n.d < edge.d)) edge = { pt: n.pt, id: seg.id, d: n.d };
    }
    if (edge) return { pt: edge.pt, kind: 'edge', id: edge.id, guides: [] };
  }

  let x = p[0];
  let y = p[1];
  let kind: SnapResult['kind'] = 'none';
  const guides: Guide[] = [];

  if (options.from && (s.angle || options.constrain)) {
    const origin = options.from;
    const dx = p[0] - origin[0];
    const dy = p[1] - origin[1];
    const len = Math.hypot(dx, dy);
    if (len > px(8)) {
      const angle = deg(Math.atan2(dy, dx));
      const step = options.constrain ? 45 : ANGLE_STEP;
      const snapped = Math.round(angle / step) * step;
      if (options.constrain || Math.abs(snapped - angle) <= ANGLE_TOLERANCE) {
        x = origin[0] + Math.cos(rad(snapped)) * len;
        y = origin[1] + Math.sin(rad(snapped)) * len;
        kind = 'angle';
      }
    }
  }

  if (s.align && kind !== 'angle') {
    const ax = nearestLine(x, ctx.lines, 'x', px(ALIGN_PX));
    const ay = nearestLine(y, ctx.lines, 'y', px(ALIGN_PX));
    if (ax !== null) {
      x = ax;
      guides.push(guideFor('x', ax, y, ctx.points));
      kind = 'align';
    }
    if (ay !== null) {
      y = ay;
      guides.push(guideFor('y', ay, x, ctx.points));
      kind = 'align';
    }
  }

  if (s.grid && kind !== 'angle') {
    const g = ctx.gridStep;
    const gx = Math.round(x / g) * g;
    const gy = Math.round(y / g) * g;
    if (!guides.some((q) => q.axis === 'x') && Math.abs(gx - x) <= px(GRID_PX)) {
      x = gx;
      kind = kind === 'none' ? 'grid' : kind;
    }
    if (!guides.some((q) => q.axis === 'y') && Math.abs(gy - y) <= px(GRID_PX)) {
      y = gy;
      kind = kind === 'none' ? 'grid' : kind;
    }
  }
  return { pt: [x, y], kind, guides };
}

export interface BoxSnap {
  dx: number;
  dy: number;
  guides: Guide[];
}

/**
 * Snap a box being moved: its edges and middle line up with other objects' edges and middles,
 * or its corner falls on the grid. Returns the nudge to apply.
 */
export function snapBox(box: Box, ctx: SnapContext): BoxSnap {
  const px = (n: number) => n / ctx.scale;
  const s = ctx.settings;
  const xs = [box.minX, (box.minX + box.maxX) / 2, box.maxX];
  const ys = [box.minY, (box.minY + box.maxY) / 2, box.maxY];
  let dx = 0;
  let dy = 0;
  const guides: Guide[] = [];
  if (s.align) {
    let bestX = px(ALIGN_PX) + 1e-9;
    for (const x of xs) {
      for (const l of ctx.lines) {
        if (l.axis !== 'x') continue;
        const d = l.pos - x;
        if (Math.abs(d) < Math.abs(bestX) && Math.abs(d) <= px(ALIGN_PX)) {
          bestX = d;
          dx = d;
        }
      }
    }
    let bestY = px(ALIGN_PX) + 1e-9;
    for (const y of ys) {
      for (const l of ctx.lines) {
        if (l.axis !== 'y') continue;
        const d = l.pos - y;
        if (Math.abs(d) < Math.abs(bestY) && Math.abs(d) <= px(ALIGN_PX)) {
          bestY = d;
          dy = d;
        }
      }
    }
    const top = box.minY - 20;
    const bottom = box.maxY + 20;
    const left = box.minX - 20;
    const right = box.maxX + 20;
    if (dx !== 0 || xs.some((x) => ctx.lines.some((l) => l.axis === 'x' && l.pos === x + dx))) {
      for (const x of xs) {
        const hit = ctx.lines.find((l) => l.axis === 'x' && Math.abs(l.pos - (x + dx)) < 1e-6);
        if (hit && Math.abs(dx) <= px(ALIGN_PX))
          guides.push({ axis: 'x', pos: hit.pos, from: top, to: bottom });
      }
    }
    if (dy !== 0 || ys.some((y) => ctx.lines.some((l) => l.axis === 'y' && l.pos === y + dy))) {
      for (const y of ys) {
        const hit = ctx.lines.find((l) => l.axis === 'y' && Math.abs(l.pos - (y + dy)) < 1e-6);
        if (hit && Math.abs(dy) <= px(ALIGN_PX))
          guides.push({ axis: 'y', pos: hit.pos, from: left, to: right });
      }
    }
  }
  if (s.grid) {
    const g = ctx.gridStep;
    if (dx === 0) {
      const gx = Math.round(box.minX / g) * g - box.minX;
      if (Math.abs(gx) <= px(GRID_PX)) dx = gx;
    }
    if (dy === 0) {
      const gy = Math.round(box.minY / g) * g - box.minY;
      if (Math.abs(gy) <= px(GRID_PX)) dy = gy;
    }
  }
  return { dx, dy, guides };
}

/** A new shape's size, nudged to match a similar shape that is already there. */
export function matchSize(
  w: number,
  h: number,
  others: { w: number; h: number }[],
  tolerance = 0.12,
): { w: number; h: number } {
  let outW = w;
  let outH = h;
  let bestW = tolerance;
  let bestH = tolerance;
  for (const o of others) {
    const dw = Math.abs(o.w - w) / Math.max(w, 1);
    const dh = Math.abs(o.h - h) / Math.max(h, 1);
    if (dw < bestW) {
      bestW = dw;
      outW = o.w;
    }
    if (dh < bestH) {
      bestH = dh;
      outH = o.h;
    }
  }
  return { w: outW, h: outH };
}
