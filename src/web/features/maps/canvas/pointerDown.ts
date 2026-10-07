/** What happens when a pointer goes down: pick the gesture, and set up its `Drag`. */
import type { PointerEvent } from 'react';
import { expandGroups, isEditable, isVisible, selectionBox } from '../engine/doc';
import type { HandleId } from '../engine/frame';
import type { Pt } from '../engine/vec';
import { angleOf } from '../engine/vec';
import { snapPoint } from '../engine/snap';
import type { ObjInfo } from '../engine/shapes';
import {
  freshObjects,
  isAttachable,
  localPoint,
  snapContextFor,
  snapEnd,
  worldPoint,
} from './helpers';
import type { CanvasEnv, ShapeTool } from './types';

const SHAPE_TOOLS: readonly string[] = ['line', 'arrow', 'rect', 'ellipse', 'connector'];
/** Tools whose first click may attach to an object under the pointer. */
const ATTACHING_TOOLS: readonly string[] = ['connector', 'line', 'arrow'];

/** Read a `data-*` attribute from the nearest element that carries it. */
const dataOf = (target: Element, name: string): string | null | undefined =>
  target.closest(`[data-${name}]`)?.getAttribute(`data-${name}`);

/** The object that was pressed, if it is visible and may be changed. */
function pressedObject(env: CanvasEnv, target: Element): ObjInfo | undefined {
  const id = dataOf(target, 'oid');
  if (!id) return undefined;
  const { objs, doc } = env.snapshot;
  const info = objs.get(id);
  return info && isVisible(doc, info) && isEditable(doc, info) ? info : undefined;
}

/** A second finger down: cancel what the first started and begin a pan-and-pinch. */
function startPinch(env: CanvasEnv): void {
  const api = env.getApi();
  if (env.drag.current && 'base' in env.drag.current) api.cancel();
  env.drag.current = null;
  env.setDraft(null);
  const [a, b] = [...env.pointers.current.values()] as [Pt, Pt];
  env.pinch.current = {
    startDist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1,
    startView: api.view,
    startMid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
  };
}

/** Press in Select mode: a handle, a vertex, a bend handle, an object, or empty space. */
function pressInSelectMode(env: CanvasEnv, e: PointerEvent, target: Element): void {
  const api = env.getApi();
  const { frame, editableSel, onlyInfo } = env.snapshot;
  const doc = api.docRef.current;
  const objs = freshObjects(api);
  const p = localPoint(env.getElement(), e);
  const w = worldPoint(api, p);
  const handle = dataOf(target, 'handle');
  const vertex = dataOf(target, 'vertex');
  const bend = target.closest('[data-bend]');

  if (handle && frame) {
    const ids = new Set(editableSel.map((i) => i.id));
    api.begin();
    env.drag.current =
      handle === 'rotate'
        ? { k: 'rotate', ids, base: doc, center: frame.center, start: angleOf(frame.center, w) }
        : { k: 'resize', handle: handle as HandleId, ids, base: doc, frame };
    return;
  }
  if (vertex !== null && vertex !== undefined && onlyInfo) {
    api.begin();
    env.drag.current = {
      k: 'vertex',
      id: onlyInfo.id,
      index: vertex === 'from' || vertex === 'to' ? vertex : Number(vertex),
      base: doc,
      ctx: snapContextFor(api, new Set([onlyInfo.id]), e),
    };
    return;
  }
  if (bend && onlyInfo) {
    api.begin();
    env.drag.current = { k: 'bend', id: onlyInfo.id, base: doc };
    return;
  }

  const hit = pressedObject(env, target);
  if (!hit) {
    env.drag.current = { k: 'marquee', a: w, additive: e.shiftKey, base: new Set(api.selection) };
    if (!e.shiftKey) api.setSelection([]);
    return;
  }

  // Shift toggles the pressed object (and its group); otherwise it becomes the selection.
  const wasSelected = api.selection.has(hit.id);
  const groupOf = () => (e.altKey ? new Set([hit.id]) : expandGroups(objs, [hit.id]));
  let ids: Set<string>;
  if (e.shiftKey) {
    const group = groupOf();
    const next = new Set(api.selection);
    for (const id of group) {
      if (wasSelected) next.delete(id);
      else next.add(id);
    }
    api.setSelection(next);
    ids = next;
  } else if (wasSelected) {
    ids = new Set(api.selection);
  } else {
    ids = groupOf();
    api.setSelection(ids);
  }

  const movable = new Set(
    [...ids].filter((id) => {
      const info = objs.get(id);
      return info && isEditable(doc, info);
    }),
  );
  const box = selectionBox(objs, movable);
  if (!box || movable.size === 0) return;
  api.begin();
  const onlyId = movable.size === 1 ? [...movable][0]! : null;
  env.drag.current = {
    k: 'move',
    ids: movable,
    start: w,
    box,
    base: doc,
    ctx: snapContextFor(api, movable, e),
    moved: false,
    hit: hit.id,
    shift: e.shiftKey,
    single: onlyId && objs.get(onlyId)?.kind === 'pin' ? onlyId : null,
  };
}

/** Press with a drawing tool: start the stroke, the shape, the measurement, or a tap. */
function pressWithTool(env: CanvasEnv, e: PointerEvent, target: Element): void {
  const api = env.getApi();
  const p = localPoint(env.getElement(), e);
  const w = worldPoint(api, p);
  const keepsSelection = api.tool === 'pin' || api.tool === 'text' || api.tool === 'note';
  api.setSelection(keepsSelection ? api.selection : []);

  if (api.tool === 'draw') {
    env.drag.current = { k: 'stroke', pts: [w] };
    env.setDraft({ k: 'stroke', pts: [w] });
    return;
  }
  if (SHAPE_TOOLS.includes(api.tool)) {
    const ctx = snapContextFor(api, new Set(), e);
    const hitId = dataOf(target, 'oid') ?? undefined;
    const hitInfo = hitId ? freshObjects(api).get(hitId) : undefined;
    const attachTo =
      ATTACHING_TOOLS.includes(api.tool) && isAttachable(hitInfo) ? hitInfo.id : undefined;
    const end = snapEnd(api, w, ctx, attachTo);
    // Pressing on an object's body (not a snap point) starts at the pointer, but still attaches.
    const start =
      attachTo && hitInfo && end.ref === attachTo && end.result.kind !== 'point' ? w : end.pt;
    env.drag.current = {
      k: 'shape',
      tool: api.tool as ShapeTool,
      a: start,
      aRef: end.ref,
      ctx,
      startPx: p,
    };
    env.setMark(end.ref ? end.pt : null);
    return;
  }
  if (api.tool === 'measure') {
    const ctx = snapContextFor(api, new Set(), e);
    const snapped = snapPoint(w, ctx);
    env.drag.current = { k: 'measure', a: snapped.pt, ctx };
    env.setDraft({ k: 'measure', a: snapped.pt, b: snapped.pt });
    return;
  }
  env.drag.current = { k: 'tap', sx: p[0], sy: p[1] };
}

export function onPointerDown(env: CanvasEnv, e: PointerEvent): void {
  if (e.button === 2) return;
  const api = env.getApi();
  try {
    env.getElement()?.setPointerCapture(e.pointerId);
  } catch {
    // A pointer that is already gone cannot be captured; the drag still works without it.
  }
  const p = localPoint(env.getElement(), e);
  env.pointers.current.set(e.pointerId, p);
  if (env.pointers.current.size === 2) {
    startPinch(env);
    return;
  }
  if (env.pointers.current.size > 2) return;

  const target = e.target as Element;
  const ruler = dataOf(target, 'ruler');
  if (ruler === 'x' || ruler === 'y') {
    env.drag.current = { k: 'newGuide', axis: ruler === 'x' ? 'y' : 'x' };
    return;
  }
  const guide = dataOf(target, 'guide');
  if (guide !== null && guide !== undefined && guide !== '') {
    api.begin();
    env.drag.current = { k: 'guide', index: Number(guide), base: api.docRef.current };
    return;
  }
  if (e.button === 1 || api.tool === 'hand' || api.spaceDown) {
    env.drag.current = { k: 'pan', sx: p[0], sy: p[1], view: api.view };
    return;
  }
  if (api.tool === 'select') pressInSelectMode(env, e, target);
  else pressWithTool(env, e, target);
}
