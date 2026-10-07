import type { ConnectorEnd } from '@shared/schemas/map';
import { angleOf, dist, lerp, mid, rad, rotateAbout, type MPt, type Pt } from '../vec';
import { textLayout } from './text';
import { PIN_R, type ConnectorShape, type ObjInfo, type Objects } from './types';

/** Where a line from the middle of `info` towards `toward` crosses the object's edge. */
export function boundaryPoint(info: ObjInfo, toward: Pt): MPt {
  const c = info.center;
  const shape = info.shape;
  if (info.kind === 'pin') {
    const a = angleOf(c, toward);
    const r = info.radius ?? PIN_R;
    return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
  }
  if (!shape) return c;
  if (shape.t === 'ellipse') {
    const local = rotateAbout(toward, c, -rad(shape.rot ?? 0));
    const dx = local[0] - c[0];
    const dy = local[1] - c[1];
    const k = 1 / Math.sqrt((dx / shape.rx) ** 2 + (dy / shape.ry) ** 2 || 1);
    return rotateAbout([c[0] + dx * k, c[1] + dy * k], c, rad(shape.rot ?? 0));
  }
  let halfW = (info.box.maxX - info.box.minX) / 2;
  let halfH = (info.box.maxY - info.box.minY) / 2;
  let rotation = 0;
  if (shape.t === 'rect') {
    halfW = shape.w / 2;
    halfH = shape.h / 2;
    rotation = shape.rot ?? 0;
  } else if (shape.t === 'text') {
    const layout = textLayout(shape);
    halfW = layout.boxW / 2;
    halfH = layout.boxH / 2;
    rotation = shape.rot ?? 0;
  }
  const local = rotateAbout(toward, c, -rad(rotation));
  const dx = local[0] - c[0];
  const dy = local[1] - c[1];
  if (dx === 0 && dy === 0) return c;
  const k = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  );
  return rotateAbout([c[0] + dx * k, c[1] + dy * k], c, rad(rotation));
}

export interface ConnectorGeometry {
  /** Points along the line, for bounds, hit tests and snapping. */
  pts: MPt[];
  /** SVG path data. */
  d: string;
  start: { pt: MPt; angle: number };
  end: { pt: MPt; angle: number };
}

/** The point an end actually sits at: on the edge of what it is attached to, or its free point. */
const endPoint = (end: ConnectorEnd, objs: Objects, toward: Pt): MPt => {
  const target = end.ref ? objs.get(end.ref) : undefined;
  return target ? boundaryPoint(target, toward) : [end.pt[0], end.pt[1]];
};

/** The centre or free point an end aims at, before edges are worked out. */
const endAim = (end: ConnectorEnd, objs: Objects): Pt => {
  const target = end.ref ? objs.get(end.ref) : undefined;
  return target ? target.center : end.pt;
};

/** Default sideways bend of a curve, as a fraction of its length. */
const DEFAULT_BEND = 0.25;

/** Unit normal of the line a to b, turned a quarter turn. Zero when the ends coincide. */
function normalOf(a: Pt, b: Pt): { n: MPt; length: number } {
  const length = dist(a, b);
  const n: MPt = length === 0 ? [0, 0] : [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
  return { n, length };
}

/** The line a connector draws, its points, and the direction it leaves each end. */
export function connectorGeometry(shape: ConnectorShape, objs: Objects): ConnectorGeometry {
  const a = endPoint(shape.from, objs, endAim(shape.to, objs));
  const b = endPoint(shape.to, objs, endAim(shape.from, objs));
  if (shape.route === 'elbow') {
    const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    const m1: MPt = horizontal ? [(a[0] + b[0]) / 2, a[1]] : [a[0], (a[1] + b[1]) / 2];
    const m2: MPt = horizontal ? [m1[0], b[1]] : [b[0], m1[1]];
    return {
      pts: [a, m1, m2, b],
      d: `M${a[0]} ${a[1]} L${m1[0]} ${m1[1]} L${m2[0]} ${m2[1]} L${b[0]} ${b[1]}`,
      start: { pt: a, angle: angleOf(m1, a) },
      end: { pt: b, angle: angleOf(m2, b) },
    };
  }
  if (shape.route === 'curve') {
    const { n, length } = normalOf(a, b);
    const bend = shape.bend ?? length * DEFAULT_BEND;
    const middle = mid(a, b);
    // A quadratic Bézier reaches half as far as its control point, hence the factor of two.
    const control: MPt = [middle[0] + n[0] * bend * 2, middle[1] + n[1] * bend * 2];
    const pts: MPt[] = [];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push(lerp(lerp(a, control, t), lerp(control, b, t), t));
    }
    return {
      pts,
      d: `M${a[0]} ${a[1]} Q${control[0]} ${control[1]} ${b[0]} ${b[1]}`,
      start: { pt: a, angle: angleOf(control, a) },
      end: { pt: b, angle: angleOf(control, b) },
    };
  }
  return {
    pts: [a, b],
    d: `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`,
    start: { pt: a, angle: angleOf(b, a) },
    end: { pt: b, angle: angleOf(a, b) },
  };
}

/** The point the bend handle of a curve connector sits at: where the curve peaks. */
export function curveControl(shape: ConnectorShape, objs: Objects): MPt {
  const straight = connectorGeometry({ ...shape, route: 'straight' }, objs);
  const a = straight.start.pt;
  const b = straight.end.pt;
  const { n, length } = normalOf(a, b);
  const bend = shape.bend ?? length * DEFAULT_BEND;
  const middle = mid(a, b);
  return [middle[0] + n[0] * bend, middle[1] + n[1] * bend];
}
