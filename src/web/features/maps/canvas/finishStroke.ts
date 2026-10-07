/**
 * Turning a finished freehand stroke into a shape: recognise it, tidy it, snap it to what is
 * already there, and offer the original back if it was changed.
 */
import type { MapShape } from '@shared/schemas/map';
import type { CanvasApi } from '../editorTypes';
import { objectsOf, type Doc } from '../engine/doc';
import { fromRecognized, makePath } from '../engine/make';
import { recognize, simplify, smoothPoints } from '../engine/recognize';
import { clean } from '../engine/shapes';
import { buildSnapContext } from '../engine/snapContext';
import { matchSize, snapBox, snapPoint, type Guide, type SnapContext } from '../engine/snap';
import { dist, round1, roundPt, type MPt, type Pt } from '../engine/vec';
import { addShape, drawStyleOf, snapEnd, snapSettingsFor, snappedToObject } from './helpers';
import type { CanvasEnv } from './types';

/** A stroke that starts this close (screen px) to the last marker starts exactly on it. */
const EXPLORE_START_PX = 44;
/** A path that ends this close (screen px) to its start closes into a loop. */
const LOOP_CLOSE_PX = 14;
/** How long smart guides stay after a shape is dropped into place. */
const GUIDE_FLASH_MS = 700;

interface Tidied {
  shape: MapShape;
  /** A point to mark where a connector snapped, or null. */
  mark?: MPt | null;
  guides?: Guide[];
}

/** Snap both ends of a recognised line or arrow, attaching to objects it lands on. */
function tidyConnector(
  api: CanvasApi,
  shape: Extract<MapShape, { t: 'connector' }>,
  objectSnap: SnapContext,
  angleSnap: boolean,
): Tidied {
  const a = snapEnd(api, shape.from.pt, objectSnap, undefined);
  const b = snapEnd(
    api,
    shape.to.pt,
    { ...objectSnap, settings: { ...objectSnap.settings, angle: angleSnap } },
    undefined,
    a.pt,
  );
  return {
    shape: {
      ...shape,
      from: clean({ pt: a.pt, ref: a.ref }),
      to: clean({ pt: b.pt, ref: b.ref }),
    },
    mark: snappedToObject(b.result.kind) ? b.pt : null,
  };
}

/** Snap the ends of an open path, and close it into a loop if it ends back on its start. */
function tidyOpenPath(
  api: CanvasApi,
  shape: Extract<MapShape, { t: 'path' }>,
  objectSnap: SnapContext,
): Tidied {
  const scale = api.view.scale;
  const pts = shape.pts.map((p): MPt => [p[0], p[1]]);
  const first = snapPoint(pts[0] as Pt, objectSnap);
  const last = snapPoint(pts[pts.length - 1] as Pt, objectSnap);
  const loops = dist(last.pt, first.pt) < LOOP_CLOSE_PX / scale && pts.length > 3;
  if (snappedToObject(first.kind)) pts[0] = first.pt;
  if (loops) {
    pts.pop();
    return {
      shape: {
        ...shape,
        pts: pts.map(roundPt),
        closed: true,
        style: { ...shape.style, fill: api.draw.fill },
      },
    };
  }
  if (snappedToObject(last.kind)) pts[pts.length - 1] = last.pt;
  return { shape: { ...shape, pts: pts.map(roundPt) } };
}

/** Match a box or oval to the sizes already on the map, then snap its edges and centre. */
function tidySizedShape(
  api: CanvasApi,
  doc: Doc,
  shape: Extract<MapShape, { t: 'rect' | 'ellipse' }>,
  fullSnap: SnapContext,
): Tidied {
  const scale = api.view.scale;
  const sizes = doc.scene.shapes
    .filter((s) => s.t === shape.t)
    .map((s) =>
      s.t === 'rect'
        ? { w: s.w, h: s.h }
        : s.t === 'ellipse'
          ? { w: s.rx * 2, h: s.ry * 2 }
          : { w: 0, h: 0 },
    );
  const w = shape.t === 'rect' ? shape.w : shape.rx * 2;
  const h = shape.t === 'rect' ? shape.h : shape.ry * 2;
  const matched = (shape.rot ?? 0) === 0 ? matchSize(w, h, sizes) : { w, h };
  const cx = shape.t === 'rect' ? shape.x + shape.w / 2 : shape.cx;
  const cy = shape.t === 'rect' ? shape.y + shape.h / 2 : shape.cy;
  const resized: MapShape =
    shape.t === 'rect'
      ? {
          ...shape,
          x: round1(cx - matched.w / 2),
          y: round1(cy - matched.h / 2),
          w: round1(matched.w),
          h: round1(matched.h),
        }
      : { ...shape, rx: round1(matched.w / 2), ry: round1(matched.h / 2) };
  const placed = objectsOf(
    { ...doc, scene: { ...doc.scene, shapes: [...doc.scene.shapes, resized] } },
    scale,
  ).get(resized.id);
  if (!placed) return { shape: resized };
  const snapped = snapBox(placed.box, fullSnap);
  const moved: MapShape =
    resized.t === 'rect'
      ? { ...resized, x: round1(resized.x + snapped.dx), y: round1(resized.y + snapped.dy) }
      : { ...resized, cx: round1(resized.cx + snapped.dx), cy: round1(resized.cy + snapped.dy) };
  return { shape: moved, guides: snapped.guides };
}

/**
 * Finish a freehand stroke. `pts` are the points the pointer visited, in map units.
 * Adds the result to the map and, when smart drawing changed it, offers the raw stroke back.
 */
export function finishStroke(env: CanvasEnv, pts: MPt[], e: { altKey: boolean }): void {
  const api = env.getApi();
  const scale = api.view.scale;
  const raw = [...pts];
  if (raw.length === 0) return;
  const doc = api.docRef.current;
  const style = drawStyleOf(api);

  // Exploring: a path that starts near the last marker starts exactly on it.
  const lastMarker =
    api.explore && api.lastMarker ? doc.pins.find((p) => p.id === api.lastMarker) : undefined;
  if (
    lastMarker &&
    raw.length > 1 &&
    dist(raw[0] as Pt, [lastMarker.x, lastMarker.y]) < EXPLORE_START_PX / scale
  ) {
    raw[0] = [lastMarker.x, lastMarker.y];
  }

  const recognised = api.settings.smart
    ? recognize(raw, { scale })
    : ({
        kind: 'path',
        pts: simplify(smoothPoints(raw, 2), Math.max(1.4 / scale, 0.4)),
        closed: false,
      } as const);
  const built = fromRecognized(recognised, style, api.layer);
  let shape = built.shape;

  const fullSnap = buildSnapContext(
    doc,
    objectsOf(doc, scale),
    new Set(),
    scale,
    snapSettingsFor(api, e),
  );
  // Ends snap to objects and the grid, but not to alignment guides.
  const objectSnap: SnapContext = { ...fullSnap, settings: { ...fullSnap.settings, align: false } };

  let tidied: Tidied = { shape };
  if (shape.t === 'connector') {
    tidied = tidyConnector(api, shape, objectSnap, fullSnap.settings.angle);
    env.setMark(tidied.mark ?? null);
  } else if (shape.t === 'path' && !shape.closed && shape.pts.length >= 2) {
    tidied = tidyOpenPath(api, shape, objectSnap);
  } else if (shape.t === 'rect' || shape.t === 'ellipse') {
    tidied = tidySizedShape(api, doc, shape, fullSnap);
    if (tidied.guides) {
      env.setGuides(tidied.guides);
      setTimeout(() => {
        env.setGuides([]);
      }, GUIDE_FLASH_MS);
    }
  }
  shape = tidied.shape;

  addShape(api, shape);

  // Exploring: a path that ends on a marker becomes the new starting point.
  if (
    api.explore &&
    shape.t === 'connector' &&
    shape.to.ref &&
    doc.pins.some((p) => p.id === shape.to.ref)
  ) {
    api.setLastMarker(shape.to.ref);
  }

  const wasTidied = built.label !== 'Smooth path' && built.label !== 'Dot';
  if (api.settings.smart && wasTidied) {
    api.onCleanup({
      label: built.label,
      id: shape.id,
      raw: makePath(simplify(raw, Math.max(1.2 / scale, 0.3)), style, api.layer, { smooth: true }),
    });
  }
}
