/**
 * Turning a scene and its pins into resolved objects: where each one is, its bounds and its flags.
 *
 * Text anchored to another object follows it, and connectors attach to the edge of what they point
 * at, so both are resolved after the plain objects.
 */
import type { MapScene, MapShape } from '@shared/schemas/map';
import type { MapPin } from '@shared/types';
import { boxCenter, boxOf, rad, rotateAbout, type MPt, type Pt } from '../vec';
import { connectorGeometry } from './connectors';
import { textCenter, textLayout, textTopLeftForCenter } from './text';
import { PIN_R, type ObjInfo, type Objects, type TextShape } from './types';

const rectCorners = (cx: number, cy: number, w: number, h: number, rot: number): MPt[] =>
  (
    [
      [cx - w / 2, cy - h / 2],
      [cx + w / 2, cy - h / 2],
      [cx + w / 2, cy + h / 2],
      [cx - w / 2, cy + h / 2],
    ] as MPt[]
  ).map((p) => rotateAbout(p, [cx, cy], rad(rot)));

function shapeInfoBase(shape: MapShape): Pick<ObjInfo, 'box' | 'center' | 'corners'> | null {
  switch (shape.t) {
    case 'path':
    case 'polygon': {
      const box = boxOf(shape.pts);
      return box ? { box, center: boxCenter(box) } : null;
    }
    case 'rect': {
      const c: MPt = [shape.x + shape.w / 2, shape.y + shape.h / 2];
      const corners = rectCorners(c[0], c[1], shape.w, shape.h, shape.rot ?? 0);
      return { box: boxOf(corners)!, center: c, corners };
    }
    case 'ellipse': {
      const a = rad(shape.rot ?? 0);
      const hw = Math.hypot(shape.rx * Math.cos(a), shape.ry * Math.sin(a));
      const hh = Math.hypot(shape.rx * Math.sin(a), shape.ry * Math.cos(a));
      return {
        box: { minX: shape.cx - hw, maxX: shape.cx + hw, minY: shape.cy - hh, maxY: shape.cy + hh },
        center: [shape.cx, shape.cy],
        corners: rectCorners(shape.cx, shape.cy, shape.rx * 2, shape.ry * 2, shape.rot ?? 0),
      };
    }
    case 'text': {
      const layout = textLayout(shape);
      const c = textCenter(shape);
      const corners = rectCorners(c[0], c[1], layout.boxW, layout.boxH, shape.rot ?? 0);
      return { box: boxOf(corners)!, center: c, corners };
    }
    case 'connector':
      return null;
  }
}

/**
 * Work out where every object is. Text anchored to an object follows it, and connectors attach
 * to the edge of whatever they point at, so both are resolved after the plain objects.
 */
export function resolveObjects(scene: MapScene, pins: readonly MapPin[], scale = 1): Objects {
  const out: Objects = new Map();
  const layerIds = new Set(scene.layers.map((l) => l.id));
  const fallbackLayer = scene.layers[0]?.id ?? 'layer-1';
  const layerOf = (id: string | undefined) =>
    id !== undefined && layerIds.has(id) ? id : fallbackLayer;
  for (const pin of pins) {
    out.set(pin.id, {
      id: pin.id,
      kind: 'pin',
      pin,
      layer: layerOf(pin.props.layer),
      hidden: pin.props.hidden ?? false,
      locked: pin.props.locked ?? false,
      group: pin.props.group,
      box: { minX: pin.x, minY: pin.y, maxX: pin.x, maxY: pin.y },
      center: [pin.x, pin.y],
      radius: PIN_R / scale,
    });
  }
  const later: MapShape[] = [];
  for (const shape of scene.shapes) {
    if (shape.t === 'connector' || (shape.t === 'text' && shape.anchor)) {
      later.push(shape);
      continue;
    }
    const base = shapeInfoBase(shape);
    if (base) out.set(shape.id, shapeInfo(shape, base, layerOf(shape.layer)));
  }
  for (const shape of later) {
    if (shape.t !== 'text') continue;
    const target = shape.anchor ? out.get(shape.anchor.ref) : undefined;
    const placed: TextShape =
      shape.anchor && target
        ? {
            ...shape,
            ...positionFor(shape, [
              target.center[0] + shape.anchor.dx,
              target.center[1] + shape.anchor.dy,
            ]),
          }
        : shape;
    const base = shapeInfoBase(placed);
    if (base) out.set(shape.id, shapeInfo(placed, base, layerOf(shape.layer)));
  }
  for (const shape of later) {
    if (shape.t !== 'connector') continue;
    const geom = connectorGeometry(shape, out);
    const box = boxOf(geom.pts) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    out.set(shape.id, shapeInfo(shape, { box, center: boxCenter(box) }, layerOf(shape.layer)));
  }
  return out;
}

function positionFor(shape: TextShape, center: Pt): { x: number; y: number } {
  const [x, y] = textTopLeftForCenter(shape, center);
  return { x, y };
}

function shapeInfo(
  shape: MapShape,
  base: Pick<ObjInfo, 'box' | 'center' | 'corners'>,
  layer: string,
): ObjInfo {
  return {
    id: shape.id,
    kind: 'shape',
    shape,
    layer,
    hidden: shape.hidden ?? false,
    locked: shape.locked ?? false,
    group: shape.group,
    ...base,
  };
}

/** The shape as it is drawn: an anchored note sits at its anchor's offset. */
export const placedShape = (info: ObjInfo): MapShape | undefined => {
  const shape = info.shape;
  if (shape?.t === 'text' && shape.anchor) {
    return { ...shape, ...positionFor(shape, info.center) };
  }
  return shape;
};
