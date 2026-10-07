/** What happens when a pointer is released: finish the gesture and save its result. */
import type { PointerEvent } from 'react';
import { LIMITS } from '@shared/constants';
import { expandGroups, isEditable, isVisible } from '../engine/doc';
import {
  DEFAULT_SHAPE,
  dragBox,
  makeConnector,
  makeEllipse,
  makeRect,
  MIN_DRAG_PX,
} from '../engine/make';
import { boxOf, dist, round1, type MPt, type Pt } from '../engine/vec';
import { RULER } from '../Overlay';
import { addShape, drawStyleOf, freshObjects, localPoint, snapEnd, worldPoint } from './helpers';
import { finishStroke } from './finishStroke';
import { handleTap } from './tap';
import type { CanvasEnv, Drag } from './types';

/** A box-select smaller than this (screen px, width plus height) counts as a click on nothing. */
const MIN_MARQUEE_PX = 4;
/** A tap that moved further than this (screen px) was a drag, not a tap. */
const TAP_SLOP_PX = 8;

type DragOf<K extends Drag['k']> = Extract<Drag, { k: K }>;

/** Select everything the box touches, plus whole groups. */
function finishMarquee(env: CanvasEnv, drag: DragOf<'marquee'>, w: MPt): void {
  const api = env.getApi();
  env.setDraft(null);
  const box = boxOf([drag.a, w]);
  if (!box) return;
  const tiny = (box.maxX - box.minX + (box.maxY - box.minY)) * api.view.scale < MIN_MARQUEE_PX;
  if (tiny) {
    if (!drag.additive) api.setSelection([]);
    return;
  }
  const objs = freshObjects(api);
  const doc = api.docRef.current;
  const hits = [...objs.values()].filter(
    (info) =>
      isVisible(doc, info) &&
      isEditable(doc, info) &&
      info.box.minX <= box.maxX &&
      info.box.maxX >= box.minX &&
      info.box.minY <= box.maxY &&
      info.box.maxY >= box.minY,
  );
  const ids = expandGroups(
    objs,
    hits.map((info) => info.id),
  );
  api.setSelection(drag.additive ? new Set([...drag.base, ...ids]) : ids);
}

/** Drop a dragged-out shape, or a default-sized box if the pointer barely moved. */
function finishShape(env: CanvasEnv, drag: DragOf<'shape'>, p: Pt, w: MPt, e: PointerEvent): void {
  const api = env.getApi();
  env.setDraft(null);
  const draggedPx = Math.hypot(p[0] - drag.startPx[0], p[1] - drag.startPx[1]);
  const style = drawStyleOf(api);
  const isBox = drag.tool === 'rect' || drag.tool === 'ellipse';
  const end = snapEnd(api, w, drag.ctx, undefined, drag.a, e.shiftKey && !isBox);
  if (isBox) {
    const box =
      draggedPx < MIN_DRAG_PX
        ? {
            x: round1(drag.a[0] - DEFAULT_SHAPE.w / 2),
            y: round1(drag.a[1] - DEFAULT_SHAPE.h / 2),
            ...DEFAULT_SHAPE,
          }
        : dragBox(drag.a, end.pt, e.shiftKey);
    addShape(
      api,
      drag.tool === 'rect' ? makeRect(box, style, api.layer) : makeEllipse(box, style, api.layer),
    );
  } else if (draggedPx >= MIN_DRAG_PX && dist(drag.a, end.pt) > 0) {
    addShape(
      api,
      makeConnector(
        { pt: drag.a, ref: drag.aRef },
        { pt: end.pt, ref: end.ref },
        style,
        api.layer,
        {
          head: drag.tool === 'arrow' || drag.tool === 'connector' ? 'end' : 'none',
          route: drag.tool === 'connector' ? 'curve' : 'straight',
        },
      ),
    );
  } else {
    return;
  }
  api.finishTool();
}

export function onPointerUp(env: CanvasEnv, e: PointerEvent): void {
  const api = env.getApi();
  const p = localPoint(env.getElement(), e);
  env.pointers.current.delete(e.pointerId);
  if (env.pinch.current) {
    if (env.pointers.current.size < 2) env.pinch.current = null;
    if (env.pointers.current.size === 0) env.drag.current = null;
    return;
  }
  const drag = env.drag.current;
  env.drag.current = null;
  env.setGuides([]);
  env.setMark(null);
  if (!drag) return;
  const w = worldPoint(api, p);

  switch (drag.k) {
    case 'pan':
      return;
    case 'marquee':
      finishMarquee(env, drag, w);
      return;
    case 'stroke':
      env.setDraft(null);
      finishStroke(env, drag.pts.length < 2 ? [...drag.pts, w] : drag.pts, e);
      return;
    case 'move':
      api.end();
      // A click on one object of a multi-selection narrows the selection to it (and its group).
      if (!drag.moved && !drag.shift && api.selection.size > 1) {
        api.setSelection(expandGroups(freshObjects(api), [drag.hit]));
      }
      return;
    case 'resize':
    case 'rotate':
    case 'vertex':
    case 'bend':
      api.end();
      return;
    case 'guide':
      api.end();
      // Dragging a guide back onto the ruler removes it.
      if (p[0] < RULER || p[1] < RULER) {
        api.commit((d) => ({
          ...d,
          scene: { ...d.scene, guides: (d.scene.guides ?? []).filter((_, i) => i !== drag.index) },
        }));
      }
      return;
    case 'newGuide': {
      env.setGuideDraft(null);
      const insideCanvas = p[0] > RULER && p[1] > RULER;
      if (insideCanvas) {
        const guide = { axis: drag.axis, pos: round1(drag.axis === 'x' ? w[0] : w[1]) };
        api.commit((d) => ({
          ...d,
          scene: {
            ...d.scene,
            guides: [...(d.scene.guides ?? []), guide].slice(0, LIMITS.mapGuides),
          },
        }));
      }
      return;
    }
    case 'shape':
      finishShape(env, drag, p, w, e);
      return;
    case 'measure':
      env.setDraft(null);
      return;
    case 'tap':
      if (Math.hypot(p[0] - drag.sx, p[1] - drag.sy) <= TAP_SLOP_PX) handleTap(env, w, e);
      return;
  }
}
