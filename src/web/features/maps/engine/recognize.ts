/**
 * Shape recognition for freehand strokes: smooth and simplify a stroke, then decide whether it is
 * a dot, line, arrow, oval, box, area or plain path. Thresholds are in screen pixels so it feels
 * the same at any zoom.
 */
import {
  angleOf,
  boxOf,
  deg,
  dist,
  nearestOnSegment,
  pathLength,
  rad,
  rotateAbout,
  round1,
  roundPt,
  type MPt,
  type Pt,
} from './vec';

/**
 * Smart drawing: turn a rough hand-drawn stroke into the clean thing it was meant to be. Pure
 * functions, tuned by feel and covered by tests with deliberately wobbly input.
 */
export type Recognized =
  | { kind: 'dot'; pt: MPt }
  | { kind: 'line'; a: MPt; b: MPt }
  | { kind: 'arrow'; a: MPt; b: MPt }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rot: number;
      circle: boolean;
    }
  | { kind: 'rect'; cx: number; cy: number; w: number; h: number; rot: number; square: boolean }
  | { kind: 'polygon'; pts: MPt[] }
  | { kind: 'path'; pts: MPt[]; closed: boolean };

function distToLine(p: Pt, a: Pt, b: Pt): number {
  const len = dist(a, b);
  if (len === 0) return dist(p, a);
  return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
}

/** Ramer-Douglas-Peucker. */
export function simplify(points: readonly Pt[], tolerance: number): MPt[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [start, end] = range;
    let worst = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const a = points[start];
      const b = points[end];
      if (!p || !a || !b) continue;
      const d = distToLine(p, a, b);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (index !== -1 && worst > tolerance) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => [p[0], p[1]]);
}

/** Average each point with its neighbours to take the hand tremor out. */
export function smoothPoints(pts: readonly Pt[], passes = 2): MPt[] {
  let cur: MPt[] = pts.map((p) => [p[0], p[1]]);
  for (let k = 0; k < passes; k++) {
    if (cur.length < 3) break;
    cur = cur.map((p, i) => {
      if (i === 0 || i === cur.length - 1) return p;
      const a = cur[i - 1]!;
      const b = cur[i + 1]!;
      return [(a[0] + p[0] * 2 + b[0]) / 4, (a[1] + p[1] * 2 + b[1]) / 4];
    });
  }
  return cur;
}

/** Evenly spaced points along a stroke, so fits do not favour where the hand slowed down. */
export function resample(pts: readonly Pt[], count: number): MPt[] {
  const total = pathLength(pts);
  if (total === 0 || pts.length < 2) return pts.map((p) => [p[0], p[1]]);
  const step = total / count;
  const out: MPt[] = [[pts[0]?.[0] ?? 0, pts[0]?.[1] ?? 0]];
  let carried = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]!;
    const b = pts[i]!;
    let seg = dist(a, b);
    while (carried + seg >= step && seg > 0) {
      const t = (step - carried) / seg;
      const p: MPt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(p);
      a = p;
      seg = dist(a, b);
      carried = 0;
    }
    carried += seg;
  }
  return out;
}

interface Frame {
  cx: number;
  cy: number;
  /** Direction of the long axis, radians. */
  angle: number;
  a: number;
  b: number;
}

/** Principal axes of a point cloud: its centre, tilt, and half-extents along each axis. */
function frameOf(pts: readonly Pt[]): Frame {
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p[0];
    my += p[1];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p[0] - mx) ** 2;
    syy += (p[1] - my) ** 2;
    sxy += (p[0] - mx) * (p[1] - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of pts) {
    const [u, v] = rotateAbout(p, [mx, my], -angle);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const mu = (minU + maxU) / 2;
  const mv = (minV + maxV) / 2;
  const [cx, cy] = rotateAbout([mu, mv], [mx, my], angle);
  return { cx, cy, angle, a: (maxU - minU) / 2, b: (maxV - minV) / 2 };
}

/** How far points stray from the fitted ellipse, as a fraction of its size. */
function ellipseError(pts: readonly Pt[], f: Frame): { mean: number; max: number } {
  if (f.a < 1e-6 || f.b < 1e-6) return { mean: 1, max: 1 };
  let total = 0;
  let max = 0;
  for (const p of pts) {
    const [u, v] = rotateAbout(p, [f.cx, f.cy], -f.angle);
    const e = Math.abs(Math.sqrt(((u - f.cx) / f.a) ** 2 + ((v - f.cy) / f.b) ** 2) - 1);
    total += e;
    max = Math.max(max, e);
  }
  return { mean: total / pts.length, max };
}

const interiorAngle = (prev: Pt, p: Pt, next: Pt): number => {
  const a1 = angleOf(p, prev);
  const a2 = angleOf(p, next);
  let d = Math.abs(deg(a1 - a2)) % 360;
  if (d > 180) d = 360 - d;
  return d;
};

/** Four right-angled corners make a rectangle: its centre, size and tilt. */
function asRectangle(
  corners: readonly MPt[],
): { cx: number; cy: number; w: number; h: number; rot: number } | null {
  if (corners.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const ang = interiorAngle(
      corners[(i + 3) % 4] as Pt,
      corners[i] as Pt,
      corners[(i + 1) % 4] as Pt,
    );
    if (Math.abs(ang - 90) > 24) return null;
  }
  const [p0, p1, p2, p3] = corners as [MPt, MPt, MPt, MPt];
  const w = (dist(p0, p1) + dist(p3, p2)) / 2;
  const h = (dist(p1, p2) + dist(p0, p3)) / 2;
  const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4;
  const cy = (p0[1] + p1[1] + p2[1] + p3[1]) / 4;
  let rot = deg(Math.atan2(p1[1] - p0[1] + (p2[1] - p3[1]), p1[0] - p0[0] + (p2[0] - p3[0])));
  // Normalise to -90..90, then lay it flat when it is nearly so.
  let width = w;
  let height = h;
  while (rot > 90) rot -= 180;
  while (rot <= -90) rot += 180;
  if (Math.abs(rot) > 45) {
    rot += rot > 0 ? -90 : 90;
    [width, height] = [height, width];
  }
  if (Math.abs(rot) < 9) rot = 0;
  return { cx, cy, w: width, h: height, rot };
}

export interface RecognizeOptions {
  /** Screen pixels per world unit: thresholds are chosen in pixels so they feel the same zoomed in or out. */
  scale: number;
}

/**
 * Decide what a stroke is. Returns the clean form; the caller turns it into an object, snaps its
 * ends, and keeps the raw points so the cleanup can be undone with one click.
 */
export function recognize(raw: readonly Pt[], { scale }: RecognizeOptions): Recognized {
  const px = (n: number) => n / scale;
  const pts = raw.map((p) => roundPt(p));
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const total = pathLength(pts);
  if (pts.length < 2 || total < px(10)) return { kind: 'dot', pt: first };

  const chord = dist(first, last);
  const box = boxOf(pts);
  const diag = box ? Math.hypot(box.maxX - box.minX, box.maxY - box.minY) : total;
  const closed = total > px(60) && chord < Math.max(px(24), 0.2 * total);

  if (!closed) {
    // A straight stroke is a line; a straight stroke with a short turn back at the end is an arrow.
    const smooth = smoothPoints(pts, 2);
    const dev = Math.max(...smooth.map((p) => distToLine(p, first, last)));
    const tipIndex = farthestFrom(smooth, first);
    const tip = smooth[tipIndex]!;
    if (tipIndex < smooth.length - 3 && tipIndex > 3) {
      const head = smooth.slice(0, tipIndex + 1);
      const tail = smooth.slice(tipIndex);
      const main = pathLength(head);
      const back = pathLength(tail);
      const headDev = Math.max(...head.map((p) => distToLine(p, first, tip)));
      const turn = interiorAngle(
        head[Math.max(0, head.length - 4)] as Pt,
        tip,
        tail[Math.min(tail.length - 1, 3)] as Pt,
      );
      if (
        main > px(30) &&
        headDev / main < 0.1 &&
        back > 0.05 * main &&
        back < 0.45 * main &&
        turn < 75
      ) {
        return { kind: 'arrow', a: first, b: tip };
      }
    }
    if (chord > px(14) && dev / chord < 0.07) return { kind: 'line', a: first, b: last };

    const tolerance = Math.max(px(1.6), diag * 0.004);
    return { kind: 'path', pts: simplify(smoothPoints(pts, 2), tolerance), closed: false };
  }

  // Closed: try a rectangle, then an ellipse, then a polygon, and otherwise a smooth loop.
  const loop = [...pts];
  const rounded = resample(loop, 64);
  const corners = simplify([...rounded, rounded[0]!], diag * 0.07);
  if (corners.length > 1 && dist(corners[0] as Pt, corners[corners.length - 1] as Pt) < diag * 0.12)
    corners.pop();
  const rectFit = asRectangle(corners);
  const frame = frameOf(rounded);
  const err = ellipseError(rounded, frame);
  if (rectFit && !(err.mean < 0.035 && err.max < 0.1)) {
    const square = Math.abs(rectFit.w - rectFit.h) / Math.max(rectFit.w, rectFit.h) < 0.16;
    const side = (rectFit.w + rectFit.h) / 2;
    return {
      kind: 'rect',
      cx: round1(rectFit.cx),
      cy: round1(rectFit.cy),
      w: round1(square ? side : rectFit.w),
      h: round1(square ? side : rectFit.h),
      rot: round1(rectFit.rot),
      square,
    };
  }
  if (err.mean < 0.075 && err.max < 0.22) {
    const circle = Math.abs(frame.a - frame.b) / Math.max(frame.a, frame.b) < 0.16;
    const r = (frame.a + frame.b) / 2;
    const long = frame.a >= frame.b;
    let rot = deg(frame.angle) + (long ? 0 : 90);
    while (rot > 90) rot -= 180;
    while (rot <= -90) rot += 180;
    if (Math.abs(rot) < 9 || Math.abs(Math.abs(rot) - 90) < 9) rot = Math.abs(rot) > 45 ? 90 : 0;
    const a = Math.max(frame.a, frame.b);
    const b = Math.min(frame.a, frame.b);
    const flat = Math.abs(rot) === 90;
    return {
      kind: 'ellipse',
      cx: round1(frame.cx),
      cy: round1(frame.cy),
      rx: round1(circle ? r : flat ? b : a),
      ry: round1(circle ? r : flat ? a : b),
      rot: circle || flat ? 0 : round1(rot),
      circle,
    };
  }
  if (corners.length >= 3 && corners.length <= 8) {
    return { kind: 'polygon', pts: corners.map((p) => roundPt(p)) };
  }
  const tolerance = Math.max(px(2), diag * 0.006);
  return { kind: 'path', pts: simplify(smoothPoints(rounded, 2), tolerance), closed: true };
}

function farthestFrom(pts: readonly Pt[], from: Pt): number {
  let best = 0;
  let index = 0;
  pts.forEach((p, i) => {
    const d = dist(p, from);
    if (d > best) {
      best = d;
      index = i;
    }
  });
  return index;
}

export { nearestOnSegment, rad };
