/**
 * The frame drawn round a selection, where its eight resize handles and the turn handle sit, and
 * how dragging a handle becomes a transform.
 */
import type { ObjInfo, Xform } from './shapes';
import { rad, rotateAbout, type Box, type MPt, type Pt } from './vec';

/** The box drawn round a selection: axis aligned, or turned to match a single turned object. */
export interface Frame {
  center: MPt;
  w: number;
  h: number;
  rot: number;
  /** True when the frame follows one object's own axes. */
  local: boolean;
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const UNIT: Record<HandleId, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function frameFor(infos: readonly ObjInfo[], box: Box): Frame {
  const only = infos.length === 1 ? infos[0] : undefined;
  const shape = only?.shape;
  if (
    shape &&
    (shape.t === 'rect' || shape.t === 'ellipse' || shape.t === 'text') &&
    (shape.rot ?? 0) !== 0
  ) {
    const c = only.corners;
    if (c) {
      const w = round2(Math.hypot(c[1]![0] - c[0]![0], c[1]![1] - c[0]![1]));
      const h = round2(Math.hypot(c[3]![0] - c[0]![0], c[3]![1] - c[0]![1]));
      return { center: only.center, w, h, rot: shape.rot ?? 0, local: true };
    }
  }
  return {
    center: [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2],
    w: box.maxX - box.minX,
    h: box.maxY - box.minY,
    rot: 0,
    local: false,
  };
}

/** Where a handle sits in the world. */
export function handlePoint(f: Frame, h: HandleId): MPt {
  const [ux, uy] = UNIT[h];
  return rotateAbout(
    [f.center[0] + (ux * f.w) / 2, f.center[1] + (uy * f.h) / 2],
    f.center,
    rad(f.rot),
  );
}

export const rotateHandlePoint = (f: Frame, offset: number): MPt =>
  rotateAbout([f.center[0], f.center[1] - f.h / 2 - offset], f.center, rad(f.rot));

export const opposite = (h: HandleId): HandleId =>
  ({ nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' })[h] as HandleId;

/**
 * Resize by dragging a handle to `pointer`: the opposite side stays put. `uniform` keeps the
 * proportions (Shift); `fromCenter` keeps the middle fixed (Alt, on a snap-free drag).
 */
export function resizeXform(
  f: Frame,
  handle: HandleId,
  pointer: Pt,
  options: { uniform?: boolean; fromCenter?: boolean } = {},
): Xform {
  const [ux, uy] = UNIT[handle];
  const anchorW = options.fromCenter ? f.center : handlePoint(f, opposite(handle));
  // Work in the frame's own axes.
  const local = (p: Pt): MPt => rotateAbout(p, f.center, -rad(f.rot));
  const a = local(anchorW);
  const h0 = local(handlePoint(f, handle));
  const p = local(pointer);
  const minSize = 4;
  let sx = ux === 0 || Math.abs(h0[0] - a[0]) < 1e-6 ? 1 : (p[0] - a[0]) / (h0[0] - a[0]);
  let sy = uy === 0 || Math.abs(h0[1] - a[1]) < 1e-6 ? 1 : (p[1] - a[1]) / (h0[1] - a[1]);
  if (options.uniform && ux !== 0 && uy !== 0) {
    const k = Math.max(Math.abs(sx), Math.abs(sy));
    sx = Math.sign(sx || 1) * k;
    sy = Math.sign(sy || 1) * k;
  } else if (options.uniform) {
    if (ux === 0) sx = sy;
    else sy = sx;
  }
  const clampDim = (s: number, size: number) =>
    Math.abs(s * size) < minSize ? Math.sign(s || 1) * (minSize / Math.max(size, 1e-6)) : s;
  sx = clampDim(sx, f.w);
  sy = clampDim(sy, f.h);
  return {
    map: (q) => {
      const l = local(q);
      const scaled: MPt = [a[0] + (l[0] - a[0]) * sx, a[1] + (l[1] - a[1]) * sy];
      return rotateAbout(scaled, f.center, rad(f.rot));
    },
    rot: 0,
    sx,
    sy,
    local: f.local,
  };
}
