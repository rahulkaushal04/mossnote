/**
 * Builders for new shapes from a gesture: boxes, ovals, lines, paths, polygons, text, and the
 * shape a recognised stroke becomes. Pure; the canvas adds the results to the document.
 */
import type { ConnectorEnd, MapShape, MapStyle } from '@shared/schemas/map';
import { clean } from './shapes';
import type { Recognized } from './recognize';
import { round1, roundPt, type MPt, type Pt } from './vec';

type Of<T extends MapShape['t']> = Extract<MapShape, { t: T }>;

export const MIN_DRAG_PX = 5;

const idOf = (): string => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** The box a drag from `a` to `b` makes. Shift makes it square, growing in the direction dragged. */
export function dragBox(
  a: Pt,
  b: Pt,
  square: boolean,
): { x: number; y: number; w: number; h: number } {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  if (square) {
    const k = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * k;
    dy = Math.sign(dy || 1) * k;
  }
  return {
    x: round1(Math.min(a[0], a[0] + dx)),
    y: round1(Math.min(a[1], a[1] + dy)),
    w: round1(Math.abs(dx)),
    h: round1(Math.abs(dy)),
  };
}

export function makeRect(
  box: { x: number; y: number; w: number; h: number },
  style: MapStyle,
  layer: string,
): Of<'rect'> {
  return {
    id: idOf(),
    t: 'rect',
    layer,
    x: box.x,
    y: box.y,
    w: Math.max(1, box.w),
    h: Math.max(1, box.h),
    style: { ...style },
  };
}

export function makeEllipse(
  box: { x: number; y: number; w: number; h: number },
  style: MapStyle,
  layer: string,
): Of<'ellipse'> {
  return {
    id: idOf(),
    t: 'ellipse',
    layer,
    cx: round1(box.x + box.w / 2),
    cy: round1(box.y + box.h / 2),
    rx: Math.max(0.5, round1(box.w / 2)),
    ry: Math.max(0.5, round1(box.h / 2)),
    style: { ...style },
  };
}

export function makeConnector(
  from: ConnectorEnd,
  to: ConnectorEnd,
  style: MapStyle,
  layer: string,
  options: { head?: 'none' | 'end' | 'both'; route?: 'straight' | 'curve' | 'elbow' } = {},
): Of<'connector'> {
  return {
    id: idOf(),
    t: 'connector',
    layer,
    from: clean({ pt: roundPt(from.pt), ref: from.ref }),
    to: clean({ pt: roundPt(to.pt), ref: to.ref }),
    route: options.route ?? 'straight',
    head: options.head ?? 'none',
    style: { ...style, fill: null },
  };
}

export function makePath(
  pts: readonly Pt[],
  style: MapStyle,
  layer: string,
  options: { closed?: boolean; smooth?: boolean } = {},
): Of<'path'> {
  return clean({
    id: idOf(),
    t: 'path' as const,
    layer,
    pts: pts.map((p) => roundPt(p)),
    closed: options.closed ? true : undefined,
    smooth: options.smooth ? true : undefined,
    style: { ...style, fill: options.closed ? style.fill : null },
  });
}

export function makePolygon(pts: readonly Pt[], style: MapStyle, layer: string): Of<'polygon'> {
  return { id: idOf(), t: 'polygon', layer, pts: pts.map((p) => roundPt(p)), style: { ...style } };
}

export function makeText(
  at: Pt,
  text: string,
  kind: Of<'text'>['kind'],
  style: MapStyle,
  layer: string,
): Of<'text'> {
  const sticky = kind === 'sticky';
  return {
    id: idOf(),
    t: 'text',
    layer,
    x: round1(at[0]),
    y: round1(at[1]),
    text,
    size: 16,
    kind,
    ...(kind === 'plain' ? {} : { w: 180 }),
    style: { ...style, width: 2, fill: sticky ? (style.fill ?? 'amber') : style.fill },
  };
}

/** A default-size box or oval for a plain click with a shape tool. */
export const DEFAULT_SHAPE = { w: 120, h: 70 };

export interface Built {
  shape: MapShape;
  /** Name of what it was recognised as, for the "tidied up" notice. */
  label: string;
}

/** Turn a recognised stroke into an object in the current drawing style. Ends are snapped by the caller. */
export function fromRecognized(rec: Recognized, style: MapStyle, layer: string): Built {
  switch (rec.kind) {
    case 'dot':
      return { shape: makePath([rec.pt], style, layer), label: 'Dot' };
    case 'line':
      return {
        shape: makeConnector({ pt: rec.a }, { pt: rec.b }, style, layer, { head: 'none' }),
        label: 'Line',
      };
    case 'arrow':
      return {
        shape: makeConnector({ pt: rec.a }, { pt: rec.b }, style, layer, { head: 'end' }),
        label: 'Arrow',
      };
    case 'ellipse': {
      const shape = {
        ...makeEllipse(
          { x: rec.cx - rec.rx, y: rec.cy - rec.ry, w: rec.rx * 2, h: rec.ry * 2 },
          style,
          layer,
        ),
        ...(rec.rot === 0 ? {} : { rot: rec.rot }),
      };
      return { shape, label: rec.circle ? 'Circle' : 'Oval' };
    }
    case 'rect': {
      const shape = {
        ...makeRect(
          { x: rec.cx - rec.w / 2, y: rec.cy - rec.h / 2, w: rec.w, h: rec.h },
          style,
          layer,
        ),
        ...(rec.rot === 0 ? {} : { rot: rec.rot }),
      };
      return { shape, label: rec.square ? 'Square' : 'Rectangle' };
    }
    case 'polygon':
      return {
        shape: makePolygon(rec.pts, style, layer),
        label: rec.pts.length === 3 ? 'Triangle' : 'Shape',
      };
    case 'path':
      return {
        shape: makePath(rec.pts, style, layer, { closed: rec.closed, smooth: true }),
        label: rec.closed ? 'Smooth loop' : 'Smooth path',
      };
  }
}

export type { MPt };
