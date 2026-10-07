/**
 * Moving, scaling and rotating shapes. An `Xform` describes one gesture; `applyXform` applies it to
 * a shape and rounds the result so saved scenes stay compact.
 */
import type { MapShape } from '@shared/schemas/map';
import { rad, rotateAbout, round1, type MPt, type Pt } from '../vec';
import { textCenter, textTopLeftForCenter } from './text';
import type { ObjInfo, TextShape } from './types';

export interface Xform {
  map: (p: Pt) => MPt;
  /** Rotation to add, in degrees. */
  rot: number;
  sx: number;
  sy: number;
  /** True when `sx` and `sy` are already along the object's own axes (resizing a turned box). */
  local?: boolean;
}

export const translateXform = (dx: number, dy: number): Xform => ({
  map: (p) => [p[0] + dx, p[1] + dy],
  rot: 0,
  sx: 1,
  sy: 1,
});

export const scaleXform = (anchor: Pt, sx: number, sy: number): Xform => ({
  map: (p) => [anchor[0] + (p[0] - anchor[0]) * sx, anchor[1] + (p[1] - anchor[1]) * sy],
  rot: 0,
  sx,
  sy,
});

export const rotateXform = (center: Pt, degrees: number): Xform => ({
  map: (p) => rotateAbout(p, center, rad(degrees)),
  rot: degrees,
  sx: 1,
  sy: 1,
});

const normDeg = (d: number): number => {
  let r = d % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return round1(r);
};

/** How a scale in world axes applies to a box that is turned by `rot` degrees. */
function localScale(rot: number, sx: number, sy: number, local = false): [number, number] {
  if (local) return [Math.abs(sx), Math.abs(sy)];
  const r = ((Math.abs(rot) % 180) + 180) % 180;
  if (r < 1 || r > 179) return [Math.abs(sx), Math.abs(sy)];
  if (Math.abs(r - 90) < 1) return [Math.abs(sy), Math.abs(sx)];
  const s = Math.sqrt(Math.abs(sx * sy));
  return [s, s];
}

const mapPts = (pts: readonly Pt[], f: (p: Pt) => MPt): MPt[] =>
  pts.map((p) => f(p)).map((p) => [round1(p[0]), round1(p[1])]);

/** Apply a move, scale or rotation to one shape. */
export function applyXform(shape: MapShape, x: Xform, info?: ObjInfo): MapShape {
  const r = (p: Pt): MPt => {
    const m = x.map(p);
    return [round1(m[0]), round1(m[1])];
  };
  switch (shape.t) {
    case 'path':
    case 'polygon':
      return { ...shape, pts: mapPts(shape.pts, x.map) };
    case 'connector':
      return {
        ...shape,
        from: { ...shape.from, pt: r(shape.from.pt) },
        to: { ...shape.to, pt: r(shape.to.pt) },
        ...(shape.bend === undefined
          ? {}
          : { bend: round1(shape.bend * Math.sqrt(Math.abs(x.sx * x.sy))) }),
      };
    case 'rect': {
      const c = r([shape.x + shape.w / 2, shape.y + shape.h / 2]);
      const [kx, ky] = localScale(shape.rot ?? 0, x.sx, x.sy, x.local);
      const w = Math.max(1, round1(shape.w * kx));
      const h = Math.max(1, round1(shape.h * ky));
      const rot = normDeg((shape.rot ?? 0) + x.rot);
      return {
        ...shape,
        x: round1(c[0] - w / 2),
        y: round1(c[1] - h / 2),
        w,
        h,
        ...(rot === 0 ? { rot: undefined } : { rot }),
      };
    }
    case 'ellipse': {
      const c = r([shape.cx, shape.cy]);
      const [kx, ky] = localScale(shape.rot ?? 0, x.sx, x.sy, x.local);
      const rot = normDeg((shape.rot ?? 0) + x.rot);
      return {
        ...shape,
        cx: c[0],
        cy: c[1],
        rx: Math.max(0.5, round1(shape.rx * kx)),
        ry: Math.max(0.5, round1(shape.ry * ky)),
        ...(rot === 0 ? { rot: undefined } : { rot }),
      };
    }
    case 'text': {
      const c = r(info ? info.center : textCenter(shape));
      const k = Math.sqrt(Math.abs(x.sx * x.sy));
      const grown: TextShape = {
        ...shape,
        size: Math.min(400, Math.max(6, round1(shape.size * k))),
        ...(shape.w === undefined
          ? {}
          : { w: Math.min(2000, Math.max(40, round1(shape.w * Math.abs(x.sx)))) }),
      };
      const rot = normDeg((shape.rot ?? 0) + x.rot);
      const [tx, ty] = textTopLeftForCenter(grown, c);
      return { ...grown, x: tx, y: ty, ...(rot === 0 ? { rot: undefined } : { rot }) };
    }
  }
}

/** Drop `undefined` keys, which the server's strict schema would reject after JSON. */
export const clean = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
