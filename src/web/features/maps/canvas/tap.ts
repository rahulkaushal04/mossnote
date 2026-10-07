/** A tap (press and release without a drag) with a placing tool: marker, text, note or area corner. */
import type { PointerEvent } from 'react';
import { LIMITS } from '@shared/constants';
import { makePin } from '../engine/doc';
import { makePolygon } from '../engine/make';
import { snapPoint } from '../engine/snap';
import { dist, type MPt } from '../engine/vec';
import { clampCoord } from '../geometry';
import { addShape, drawStyleOf, snapContextFor } from './helpers';
import type { CanvasEnv } from './types';

/** Clicking this close (screen px) to an area's first corner closes it. */
const CLOSE_AREA_PX = 12;

/** Close an area and add it, if it has at least three corners. */
export function finishPolygon(env: CanvasEnv, pts: MPt[]): void {
  env.setDraft(null);
  env.setMark(null);
  if (pts.length < 3) return;
  const api = env.getApi();
  addShape(api, makePolygon(pts, drawStyleOf(api), api.layer));
  api.finishTool();
}

export function handleTap(env: CanvasEnv, w: MPt, e: PointerEvent): void {
  const api = env.getApi();
  const ctx = snapContextFor(api, new Set(), e);
  switch (api.tool) {
    case 'pin': {
      const snapped = snapPoint(w, {
        ...ctx,
        settings: { ...ctx.settings, objects: false, angle: false },
      });
      if (api.docRef.current.pins.length >= LIMITS.pinsPerMap) {
        api.notify('A map can hold up to 500 pins.');
        return;
      }
      const id = api.newPinId();
      const pin = makePin(
        api.mapId,
        id,
        clampCoord(snapped.pt[0]),
        clampCoord(snapped.pt[1]),
        api.layer,
        { color: api.draw.stroke === 'ink' ? 'moss' : api.draw.stroke },
      );
      api.commit((d) => ({ ...d, pins: [...d.pins, pin] }));
      api.setSelection([id]);
      api.setLastMarker(id);
      api.onPinPlaced(id);
      return;
    }
    case 'text':
    case 'note': {
      const snapped = snapPoint(w, ctx);
      env.setEdit({
        id: null,
        at: snapped.pt,
        kind: api.tool === 'note' ? 'sticky' : 'plain',
        text: '',
      });
      return;
    }
    case 'polygon': {
      const snapped = snapPoint(w, ctx);
      const draft = env.snapshot.draft;
      const corners = draft?.k === 'poly' ? draft.pts : [];
      const first = corners[0];
      if (
        first &&
        corners.length >= 3 &&
        dist(first, snapped.pt) < CLOSE_AREA_PX / api.view.scale
      ) {
        finishPolygon(env, corners);
        return;
      }
      env.setDraft({ k: 'poly', pts: [...corners, snapped.pt], cursor: snapped.pt });
      return;
    }
    default:
  }
}
