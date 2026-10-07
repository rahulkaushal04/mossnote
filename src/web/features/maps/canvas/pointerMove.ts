/** What happens as a pointer moves: advance the `Drag` and show a live preview. */
import type { PointerEvent } from 'react';
import { LIMITS } from '@shared/constants';
import type { CanvasApi } from '../editorTypes';
import { moveObjects, rotateObjects, transformObjects, updateShape } from '../engine/doc';
import { resizeXform } from '../engine/frame';
import { dragBox, makeConnector, makeEllipse, makeRect } from '../engine/make';
import { clean } from '../engine/shapes';
import { snapBox, snapPoint, type Guide } from '../engine/snap';
import { angleOf, dist, round1, roundPt, type MPt, type Pt } from '../engine/vec';
import { panBy, toWorld, zoomAt } from '../geometry';
import {
  clampPoint,
  drawStyleOf,
  freshObjects,
  isAttachable,
  localPoint,
  snapContextFor,
  snapEnd,
  snapSettingsFor,
  snappedToObject,
  worldPoint,
} from './helpers';
import type { CanvasEnv, Drag } from './types';

/** The pointer must travel this far (screen px) before a press on an object becomes a move. */
const MOVE_THRESHOLD_PX = 3;
/** A new stroke point is only kept when it is this far (screen px) from the last. */
const STROKE_MIN_STEP_PX = 2;
/** Rotation snaps to this step, in degrees. */
const ROTATE_STEP = 15;
/** Rotation within this many degrees of a step jumps to it when angle snapping is on. */
const ROTATE_CATCH = 4;

type Modifiers = Pick<PointerEvent, 'shiftKey' | 'altKey'>;
type DragOf<K extends Drag['k']> = Extract<Drag, { k: K }>;

function moveSelection(
  env: CanvasEnv,
  api: CanvasApi,
  drag: DragOf<'move'>,
  w: MPt,
  e: Modifiers,
): void {
  let dx = w[0] - drag.start[0];
  let dy = w[1] - drag.start[1];
  if (!drag.moved && Math.hypot(dx, dy) * api.view.scale < MOVE_THRESHOLD_PX) return;
  drag.moved = true;
  if (e.shiftKey) {
    // Shift locks the move to one axis.
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  const settings = snapSettingsFor(api, e);
  let guides: Guide[] = [];
  const marker = drag.single ? drag.base.pins.find((q) => q.id === drag.single) : undefined;
  if (marker) {
    const snapped = snapPoint([marker.x + dx, marker.y + dy], { ...drag.ctx, settings });
    dx = snapped.pt[0] - marker.x;
    dy = snapped.pt[1] - marker.y;
    guides = snapped.guides;
    env.setMark(snappedToObject(snapped.kind) ? snapped.pt : null);
  } else if (!drag.single) {
    const moved = {
      minX: drag.box.minX + dx,
      minY: drag.box.minY + dy,
      maxX: drag.box.maxX + dx,
      maxY: drag.box.maxY + dy,
    };
    const snapped = snapBox(moved, { ...drag.ctx, settings });
    dx += snapped.dx;
    dy += snapped.dy;
    guides = snapped.guides;
  }
  env.setGuides(guides);
  api.live(() => moveObjects(drag.base, drag.ids, round1(dx), round1(dy)));
}

function resizeSelection(
  env: CanvasEnv,
  api: CanvasApi,
  drag: DragOf<'resize'>,
  w: MPt,
  e: PointerEvent,
): void {
  const snapped = snapPoint(w, {
    ...snapContextFor(api, drag.ids, e),
    settings: { ...snapSettingsFor(api, e), objects: false, angle: false },
  });
  env.setGuides(snapped.guides);
  const xform = resizeXform(drag.frame, drag.handle, snapped.pt, { uniform: e.shiftKey });
  api.live(() => transformObjects(drag.base, drag.ids, xform));
}

function rotateSelection(api: CanvasApi, drag: DragOf<'rotate'>, w: MPt, e: Modifiers): void {
  let delta = ((angleOf(drag.center, w) - drag.start) * 180) / Math.PI;
  const angleSnap = api.settings.snap && api.settings.snaps.angle && !e.altKey;
  if (e.shiftKey || angleSnap) {
    const stepped = Math.round(delta / ROTATE_STEP) * ROTATE_STEP;
    if (e.shiftKey || Math.abs(stepped - delta) < ROTATE_CATCH) delta = stepped;
  }
  api.live(() => rotateObjects(drag.base, drag.ids, drag.center, round1(delta)));
}

/** Drag one corner of an area or path, or one end of a connector. */
function moveVertex(
  env: CanvasEnv,
  api: CanvasApi,
  drag: DragOf<'vertex'>,
  w: MPt,
  e: PointerEvent,
): void {
  const shape = drag.base.scene.shapes.find((s) => s.id === drag.id);
  if (!shape) return;
  const isConnectorEnd = typeof drag.index === 'string';
  const from =
    shape.t === 'connector' && isConnectorEnd
      ? (drag.index === 'from' ? shape.to : shape.from).pt
      : undefined;
  const snapped = snapPoint(
    w,
    { ...drag.ctx, settings: snapSettingsFor(api, e) },
    { from, constrain: e.shiftKey },
  );
  env.setGuides(snapped.guides);
  env.setMark(snappedToObject(snapped.kind) ? snapped.pt : null);
  const pt = roundPt(clampPoint(snapped.pt));
  api.live((cur) =>
    updateShape(cur, drag.id, (sh) => {
      if (sh.t === 'connector' && typeof drag.index === 'string') {
        const target = snapped.id ? freshObjects(api).get(snapped.id) : undefined;
        const ref =
          snappedToObject(snapped.kind) && isAttachable(target) && target.id !== drag.id
            ? target.id
            : undefined;
        const end = clean({ pt, ref });
        return drag.index === 'from' ? { ...sh, from: end } : { ...sh, to: end };
      }
      if ((sh.t === 'polygon' || sh.t === 'path') && typeof drag.index === 'number') {
        return { ...sh, pts: sh.pts.map((q, i) => (i === drag.index ? pt : q)) };
      }
      return sh;
    }),
  );
}

/** Drag the bend handle of a curved connector: the bend is the pointer's distance from the chord. */
function bendConnector(api: CanvasApi, drag: DragOf<'bend'>, w: MPt): void {
  const shape = drag.base.scene.shapes.find((s) => s.id === drag.id);
  const objs = freshObjects(api);
  if (shape?.t !== 'connector' || !objs.get(drag.id)) return;
  const aim = (end: typeof shape.from): Pt =>
    end.ref ? (objs.get(end.ref)?.center ?? end.pt) : end.pt;
  const a = aim(shape.from);
  const b = aim(shape.to);
  const middle: MPt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const length = dist(a, b) || 1;
  const normal: MPt = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
  const bend = round1((w[0] - middle[0]) * normal[0] + (w[1] - middle[1]) * normal[1]);
  api.live((cur) =>
    updateShape(cur, drag.id, (sh) => (sh.t === 'connector' ? { ...sh, bend } : sh)),
  );
}

/** Update the preview of a line, arrow, connector, box or oval being dragged out. */
function previewShape(
  env: CanvasEnv,
  api: CanvasApi,
  drag: DragOf<'shape'>,
  w: MPt,
  e: Modifiers,
): void {
  const constrain =
    e.shiftKey && (drag.tool === 'line' || drag.tool === 'arrow' || drag.tool === 'connector');
  const end = snapEnd(api, w, drag.ctx, undefined, drag.a, constrain);
  env.setGuides(end.result.guides);
  env.setMark(end.ref ? end.pt : null);
  const style = drawStyleOf(api);
  if (drag.tool === 'rect' || drag.tool === 'ellipse') {
    const box = dragBox(drag.a, end.pt, e.shiftKey);
    env.setDraft({
      k: 'shape',
      shape:
        drag.tool === 'rect' ? makeRect(box, style, api.layer) : makeEllipse(box, style, api.layer),
    });
    return;
  }
  env.setDraft({
    k: 'shape',
    shape: makeConnector(
      { pt: drag.a, ref: drag.aRef },
      { pt: end.pt, ref: end.ref },
      style,
      api.layer,
      {
        head: drag.tool === 'arrow' || drag.tool === 'connector' ? 'end' : 'none',
        route: drag.tool === 'connector' ? 'curve' : 'straight',
      },
    ),
  });
}

/** Update an in-progress two-finger pan and pinch. */
function updatePinch(env: CanvasEnv, api: CanvasApi): void {
  const pinch = env.pinch.current;
  if (!pinch) return;
  const [a, b] = [...env.pointers.current.values()] as [Pt, Pt];
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const middle: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const zoomed = zoomAt(
    pinch.startView,
    api.size,
    pinch.startMid[0],
    pinch.startMid[1],
    distance / pinch.startDist,
  );
  api.setView(panBy(zoomed, middle[0] - pinch.startMid[0], middle[1] - pinch.startMid[1]));
}

export function onPointerMove(env: CanvasEnv, e: PointerEvent): void {
  const api = env.getApi();
  const element = env.getElement();
  if (!env.pointers.current.has(e.pointerId)) {
    // A hover, not a drag. Only an unfinished area follows it, to draw the next edge.
    const draft = env.snapshot.draft;
    if (draft?.k === 'poly') {
      const [x, y] = localPoint(element, e);
      const snapped = snapPoint(
        toWorld(api.view, api.size, x, y),
        snapContextFor(api, new Set(), e),
      );
      env.setDraft({ ...draft, cursor: snapped.pt });
      env.setMark(snappedToObject(snapped.kind) ? snapped.pt : null);
    }
    return;
  }
  const p = localPoint(element, e);
  env.pointers.current.set(e.pointerId, p);
  if (env.pinch.current && env.pointers.current.size >= 2) {
    updatePinch(env, api);
    return;
  }
  const drag = env.drag.current;
  if (!drag) return;
  const w = worldPoint(api, p);

  switch (drag.k) {
    case 'pan':
      api.setView(panBy(drag.view, p[0] - drag.sx, p[1] - drag.sy));
      return;
    case 'marquee':
      env.setDraft({ k: 'marquee', a: drag.a, b: w });
      return;
    case 'stroke': {
      const last = drag.pts[drag.pts.length - 1]!;
      const tooClose = dist(last, w) * api.view.scale < STROKE_MIN_STEP_PX;
      if (tooClose || drag.pts.length >= LIMITS.mapStrokePoints) return;
      drag.pts.push(w);
      env.setDraft({ k: 'stroke', pts: [...drag.pts] });
      return;
    }
    case 'move':
      moveSelection(env, api, drag, w, e);
      return;
    case 'resize':
      resizeSelection(env, api, drag, w, e);
      return;
    case 'rotate':
      rotateSelection(api, drag, w, e);
      return;
    case 'vertex':
      moveVertex(env, api, drag, w, e);
      return;
    case 'bend':
      bendConnector(api, drag, w);
      return;
    case 'shape':
      previewShape(env, api, drag, w, e);
      return;
    case 'measure': {
      const snapped = snapPoint(w, drag.ctx, { from: drag.a, constrain: e.shiftKey });
      env.setDraft({ k: 'measure', a: drag.a, b: snapped.pt });
      env.setGuides(snapped.guides);
      return;
    }
    case 'newGuide':
      env.setGuideDraft({ axis: drag.axis, pos: round1(drag.axis === 'x' ? w[0] : w[1]) });
      return;
    case 'guide': {
      const guide = drag.base.scene.guides?.[drag.index];
      if (!guide) return;
      const pos = round1(guide.axis === 'x' ? w[0] : w[1]);
      api.live((cur) => ({
        ...cur,
        scene: {
          ...cur.scene,
          guides: cur.scene.guides?.map((q, i) => (i === drag.index ? { ...q, pos } : q)),
        },
      }));
      return;
    }
    case 'tap':
      return;
  }
}
