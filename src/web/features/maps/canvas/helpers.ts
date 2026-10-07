/** Small functions the pointer handlers share: coordinates, snapping context, adding shapes. */
import type { MapShape } from '@shared/schemas/map';
import { LIMITS } from '@shared/constants';
import type { CanvasApi, DrawStyle } from '../editorTypes';
import { addShapes, objectsOf } from '../engine/doc';
import { clean, type ObjInfo, type Objects } from '../engine/shapes';
import { buildSnapContext } from '../engine/snapContext';
import { snapPoint, type SnapContext, type SnapSettings } from '../engine/snap';
import type { MPt, Pt } from '../engine/vec';
import { clampCoord, toWorld } from '../geometry';
import { SNAP_OFF } from './types';

/** Keep a point inside the storable area. */
export const clampPoint = (p: Pt): MPt => [clampCoord(p[0]), clampCoord(p[1])];

/** A pointer position relative to the canvas element, in screen pixels. */
export function localPoint(
  element: HTMLElement | null,
  e: { clientX: number; clientY: number },
): Pt {
  const rect = element?.getBoundingClientRect();
  return [e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0)];
}

/** A screen point as a (clamped) point on the map. */
export const worldPoint = (api: CanvasApi, p: Pt): MPt =>
  clampPoint(toWorld(api.view, api.size, p[0], p[1]));

/** Snapping as the editor has it set, or all off while Alt is held. */
export const snapSettingsFor = (api: CanvasApi, e: { altKey: boolean }): SnapSettings =>
  api.settings.snap && !e.altKey ? api.settings.snaps : SNAP_OFF;

/** Objects resolved from the latest document, not the last render's. */
export const freshObjects = (api: CanvasApi): Objects =>
  objectsOf(api.docRef.current, api.view.scale);

/** What a drag may snap to, leaving out the things being dragged. */
export const snapContextFor = (
  api: CanvasApi,
  exclude: ReadonlySet<string>,
  e: { altKey: boolean },
): SnapContext =>
  buildSnapContext(
    api.docRef.current,
    freshObjects(api),
    exclude,
    api.view.scale,
    snapSettingsFor(api, e),
  );

/** The style new drawings take. */
export const drawStyleOf = (api: CanvasApi): DrawStyle => ({
  stroke: api.draw.stroke,
  fill: api.draw.fill,
  width: api.draw.width,
  dash: api.draw.dash,
});

/** Objects a connector or line can attach to. */
const ATTACHABLE_SHAPES = new Set(['rect', 'ellipse', 'text', 'pin']);
export const isAttachable = (info: ObjInfo | undefined): info is ObjInfo =>
  info !== undefined &&
  (info.kind === 'pin' || (info.shape !== undefined && ATTACHABLE_SHAPES.has(info.shape.t)));

/** Add a shape to the map, and select it, unless the map is full. */
export function addShape(api: CanvasApi, shape: MapShape, select = true): void {
  if (api.docRef.current.scene.shapes.length >= LIMITS.mapShapes) {
    api.notify('This map has too many drawings.');
    return;
  }
  api.commit((d) => addShapes(d, [clean(shape)]));
  if (select) api.setSelection([shape.id]);
}

/** Snap one end of a new line: to another object's point or edge (and attach to it), else the grid. */
export function snapEnd(
  api: CanvasApi,
  p: Pt,
  ctx: SnapContext,
  hitId: string | undefined,
  from?: Pt,
  constrain = false,
) {
  const result = snapPoint(p, ctx, { from, constrain });
  const objs = freshObjects(api);
  const target = result.id ? objs.get(result.id) : hitId ? objs.get(hitId) : undefined;
  const ref =
    (result.kind === 'point' || result.kind === 'edge' || hitId) && isAttachable(target)
      ? target.id
      : undefined;
  return { pt: clampPoint(result.pt), ref, result };
}

/** True when a snap landed on another object's point or edge. */
export const snappedToObject = (kind: string): boolean => kind === 'point' || kind === 'edge';
