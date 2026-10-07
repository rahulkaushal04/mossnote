/** Reading a `Doc`: resolved objects, visibility, groups, selection bounds. */
import type { MapLayer } from '@shared/schemas/map';
import type { Unit } from '../align';
import { resolveObjects, type ObjInfo, type Objects } from '../shapes';
import { inflate, unionBox, type Box } from '../vec';
import type { Doc } from './model';

export const objectsOf = (doc: Doc, scale = 1): Objects =>
  resolveObjects(doc.scene, doc.pins, scale);

const layerOf = (doc: Doc, info: ObjInfo): MapLayer | undefined =>
  doc.scene.layers.find((l) => l.id === info.layer);

/** Can the user see and click this? Hidden objects, and objects on hidden layers, cannot be. */
export const isVisible = (doc: Doc, info: ObjInfo): boolean =>
  !info.hidden && !(layerOf(doc, info)?.hidden ?? false);

/** Can the user change this? Locked objects and locked layers stay put. */
export const isEditable = (doc: Doc, info: ObjInfo): boolean =>
  !info.locked && !(layerOf(doc, info)?.locked ?? false);

/** Add everyone who shares a group with something already in the list. */
export function expandGroups(objs: Objects, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const groups = new Set<string>();
  for (const id of out) {
    const group = objs.get(id)?.group;
    if (group) groups.add(group);
  }
  if (groups.size === 0) return out;
  for (const info of objs.values()) if (info.group && groups.has(info.group)) out.add(info.id);
  return out;
}

/** The selection as units that move together: each group counts once. */
export function unitsOf(objs: Objects, ids: Iterable<string>): Unit[] {
  const byGroup = new Map<string, Unit>();
  const units: Unit[] = [];
  for (const id of ids) {
    const info = objs.get(id);
    if (!info) continue;
    const key = info.group;
    const existing = key ? byGroup.get(key) : undefined;
    if (existing) {
      existing.ids.push(id);
      existing.box = unionBox(existing.box, info.box) ?? existing.box;
    } else {
      const unit: Unit = { ids: [id], box: { ...info.box } };
      units.push(unit);
      if (key) byGroup.set(key, unit);
    }
  }
  return units;
}

/** The box round the selected objects, or null when none of the ids exist. */
export function selectionBox(objs: Objects, ids: Iterable<string>): Box | null {
  let box: Box | null = null;
  for (const id of ids) box = unionBox(box, objs.get(id)?.box ?? null);
  return box && { ...box };
}

/** The area covering everything visible, with a margin; null for an empty map. */
export function contentBox(doc: Doc, margin = 40): Box | null {
  const objs = objectsOf(doc);
  let box: Box | null = null;
  for (const info of objs.values()) {
    if (!isVisible(doc, info)) continue;
    const b = info.kind === 'pin' ? inflate(info.box, 20) : info.box;
    box = unionBox(box, b);
  }
  return box ? inflate(box, margin) : null;
}
