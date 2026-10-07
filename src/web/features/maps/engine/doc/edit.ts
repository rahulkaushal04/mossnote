/** Editing objects: add, update, remove, transform, align, style, group and order. */
import type { MapShape, MapStyle, PinProps } from '@shared/schemas/map';
import type { MapPin } from '@shared/types';
import { alignDeltas, distributeDeltas, type AlignKind } from '../align';
import {
  applyXform,
  clean,
  placedShape,
  rotateXform,
  scaleXform,
  translateXform,
  type Xform,
} from '../shapes';
import { round1, type Pt } from '../vec';
import { groupId, isPinId, type Doc } from './model';
import { objectsOf, unitsOf } from './read';

const withShapes = (doc: Doc, shapes: MapShape[]): Doc => ({
  ...doc,
  scene: { ...doc.scene, shapes },
});
const withPins = (doc: Doc, pins: MapPin[]): Doc => ({ ...doc, pins });

export function addShapes(doc: Doc, shapes: MapShape[]): Doc {
  return withShapes(doc, [...doc.scene.shapes, ...shapes]);
}

export function updateShape(doc: Doc, id: string, fn: (s: MapShape) => MapShape): Doc {
  return withShapes(
    doc,
    doc.scene.shapes.map((s) => (s.id === id ? clean(fn(s)) : s)),
  );
}

export function updatePin(doc: Doc, id: string, fn: (p: MapPin) => MapPin): Doc {
  return withPins(
    doc,
    doc.pins.map((p) => (p.id === id ? fn(p) : p)),
  );
}

export function updatePinProps(doc: Doc, id: string, patch: Partial<PinProps>): Doc {
  return updatePin(doc, id, (p) => ({ ...p, props: clean({ ...p.props, ...patch }) }));
}

/** Delete objects. Connectors and notes that pointed at them are left where they were, free. */
export function removeObjects(doc: Doc, ids: ReadonlySet<string>): Doc {
  if (ids.size === 0) return doc;
  const objs = objectsOf(doc);
  const shapes: MapShape[] = [];
  for (const s of doc.scene.shapes) {
    if (ids.has(s.id)) continue;
    if (s.t === 'connector') {
      const detach = (end: typeof s.from) => {
        if (!end.ref || !ids.has(end.ref)) return end;
        return { pt: objs.get(end.ref)?.center ?? end.pt };
      };
      shapes.push({ ...s, from: detach(s.from), to: detach(s.to) });
    } else if (s.t === 'text' && s.anchor && ids.has(s.anchor.ref)) {
      const placed = placedShape(objs.get(s.id)!) as typeof s;
      shapes.push(clean({ ...placed, anchor: undefined }));
    } else shapes.push(s);
  }
  return { scene: { ...doc.scene, shapes }, pins: doc.pins.filter((p) => !ids.has(p.id)) };
}

/** Apply a transform to objects, keeping anchored notes and attached connectors consistent. */
export function transformObjects(doc: Doc, ids: ReadonlySet<string>, x: Xform): Doc {
  const objs = objectsOf(doc);
  const shapes = doc.scene.shapes.map((s) => {
    if (!ids.has(s.id)) return s;
    const info = objs.get(s.id);
    if (!info) return s;
    if (s.t === 'text' && s.anchor) {
      // A note that moves with its object stays put relative to it; one moved alone re-anchors.
      if (ids.has(s.anchor.ref)) return s;
      const placed = placedShape(info) as typeof s;
      const moved = applyXform({ ...placed, anchor: undefined }, x, info) as typeof s;
      const ref = objs.get(s.anchor.ref);
      if (!ref) return clean(moved);
      const mx = x.map(info.center);
      return clean({
        ...moved,
        anchor: {
          ref: s.anchor.ref,
          dx: round1(mx[0] - ref.center[0]),
          dy: round1(mx[1] - ref.center[1]),
        },
      });
    }
    return clean(applyXform(s, x, info));
  });
  const pins = doc.pins.map((p) => {
    if (!ids.has(p.id)) return p;
    const [nx, ny] = x.map([p.x, p.y]);
    return { ...p, x: round1(nx), y: round1(ny) };
  });
  return { scene: { ...doc.scene, shapes }, pins };
}

export const moveObjects = (doc: Doc, ids: ReadonlySet<string>, dx: number, dy: number): Doc =>
  transformObjects(doc, ids, translateXform(dx, dy));

export const rotateObjects = (
  doc: Doc,
  ids: ReadonlySet<string>,
  center: Pt,
  degrees: number,
): Doc => transformObjects(doc, ids, rotateXform(center, degrees));

export const scaleObjects = (
  doc: Doc,
  ids: ReadonlySet<string>,
  anchor: Pt,
  sx: number,
  sy: number,
): Doc => transformObjects(doc, ids, scaleXform(anchor, sx, sy));

/** Move individual objects by their own amounts (align and distribute). */
export function nudgeEach(doc: Doc, deltas: Map<string, [number, number]>): Doc {
  let out = doc;
  const byDelta = new Map<string, Set<string>>();
  for (const [id, [dx, dy]] of deltas) {
    const key = `${dx}:${dy}`;
    (byDelta.get(key) ?? byDelta.set(key, new Set()).get(key))?.add(id);
  }
  for (const [key, ids] of byDelta) {
    const [dx, dy] = key.split(':').map(Number) as [number, number];
    out = moveObjects(out, ids, dx, dy);
  }
  return out;
}

export function alignObjects(doc: Doc, ids: Iterable<string>, kind: AlignKind): Doc {
  return nudgeEach(doc, alignDeltas(unitsOf(objectsOf(doc), ids), kind));
}

export function distributeObjects(doc: Doc, ids: Iterable<string>, axis: 'h' | 'v'): Doc {
  return nudgeEach(doc, distributeDeltas(unitsOf(objectsOf(doc), ids), axis));
}

/** Change drawing style on shapes; on a pin, colour is its fill. */
export function setStyle(doc: Doc, ids: ReadonlySet<string>, patch: Partial<MapStyle>): Doc {
  const shapes = doc.scene.shapes.map((s) =>
    ids.has(s.id) ? { ...s, style: { ...s.style, ...patch } } : s,
  );
  const pins =
    patch.stroke === undefined
      ? doc.pins
      : doc.pins.map((p) => (ids.has(p.id) ? { ...p, color: patch.stroke! } : p));
  return { scene: { ...doc.scene, shapes }, pins };
}

export function setFlag(
  doc: Doc,
  ids: ReadonlySet<string>,
  flag: 'locked' | 'hidden',
  value: boolean,
): Doc {
  const shapes = doc.scene.shapes.map((s): MapShape =>
    ids.has(s.id) ? clean({ ...s, [flag]: value ? true : undefined }) : s,
  );
  const pins = doc.pins.map((p) =>
    ids.has(p.id) ? { ...p, props: clean({ ...p.props, [flag]: value ? true : undefined }) } : p,
  );
  return { scene: { ...doc.scene, shapes }, pins };
}

export function renameObject(doc: Doc, id: string, name: string): Doc {
  const value = name.trim().slice(0, 80);
  if (isPinId(doc, id)) return updatePin(doc, id, (p) => ({ ...p, label: value }));
  return updateShape(doc, id, (s) => ({ ...s, name: value === '' ? undefined : value }));
}

export function setNote(doc: Doc, id: string, note: string): Doc {
  if (isPinId(doc, id)) return updatePin(doc, id, (p) => ({ ...p, note: note.slice(0, 5000) }));
  return updateShape(doc, id, (s) => ({
    ...s,
    note: note.trim() === '' ? undefined : note.slice(0, 500),
  }));
}

export function group(doc: Doc, ids: ReadonlySet<string>): Doc {
  if (ids.size < 2) return doc;
  const g = groupId();
  const shapes = doc.scene.shapes.map((s) => (ids.has(s.id) ? { ...s, group: g } : s));
  const pins = doc.pins.map((p) => (ids.has(p.id) ? { ...p, props: { ...p.props, group: g } } : p));
  return { scene: { ...doc.scene, shapes }, pins };
}

export function ungroup(doc: Doc, ids: ReadonlySet<string>): Doc {
  const objs = objectsOf(doc);
  const groups = new Set<string>();
  for (const id of ids) {
    const g = objs.get(id)?.group;
    if (g) groups.add(g);
  }
  if (groups.size === 0) return doc;
  const shapes = doc.scene.shapes.map((s) =>
    s.group && groups.has(s.group) ? clean({ ...s, group: undefined }) : s,
  );
  const pins = doc.pins.map((p) =>
    p.props.group && groups.has(p.props.group)
      ? { ...p, props: clean({ ...p.props, group: undefined }) }
      : p,
  );
  return { scene: { ...doc.scene, shapes }, pins };
}

export type Order = 'front' | 'back' | 'forward' | 'backward';

/** Change stacking among drawn objects. Pins always sit above the drawing of their layer. */
export function reorder(doc: Doc, ids: ReadonlySet<string>, order: Order): Doc {
  const shapes = [...doc.scene.shapes];
  const picked = shapes.filter((s) => ids.has(s.id));
  if (picked.length === 0) return doc;
  const rest = shapes.filter((s) => !ids.has(s.id));
  if (order === 'front') return withShapes(doc, [...rest, ...picked]);
  if (order === 'back') return withShapes(doc, [...picked, ...rest]);
  const out = [...shapes];
  const indexes = shapes.map((s, i) => (ids.has(s.id) ? i : -1)).filter((i) => i >= 0);
  if (order === 'forward') {
    for (const i of [...indexes].reverse()) {
      if (i < out.length - 1 && !ids.has(out[i + 1]!.id))
        [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
    }
  } else {
    for (const i of indexes) {
      if (i > 0 && !ids.has(out[i - 1]!.id)) [out[i], out[i - 1]] = [out[i - 1]!, out[i]!];
    }
  }
  return withShapes(doc, out);
}
