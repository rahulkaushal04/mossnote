/** Copy, paste and duplicate, and creating pins. */
import type { MapShape, PinProps } from '@shared/schemas/map';
import type { MapPin } from '@shared/types';
import { applyXform, clean, translateXform } from '../shapes';
import { round1, type Pt } from '../vec';
import { groupId, shapeId, type Doc } from './model';

export interface Clip {
  shapes: MapShape[];
  pins: MapPin[];
}

export function copyObjects(doc: Doc, ids: ReadonlySet<string>): Clip {
  return {
    shapes: doc.scene.shapes.filter((s) => ids.has(s.id)),
    pins: doc.pins.filter((p) => ids.has(p.id)),
  };
}

/**
 * Insert copies with fresh ids, shifted by `offset`. Links between the copies are kept pointing at
 * the copies; links to things that were not copied stay as they were. Groups stay groups.
 */
export function pasteClip(
  doc: Doc,
  clip: Clip,
  offset: Pt,
  options: { layer?: string | undefined; newPinId: () => string; mapId: string; now: string },
): { doc: Doc; ids: string[] } {
  const ids = new Map<string, string>();
  for (const s of clip.shapes) ids.set(s.id, shapeId());
  for (const p of clip.pins) ids.set(p.id, options.newPinId());
  const groups = new Map<string, string>();
  const g = (old: string | undefined) => {
    if (!old) return undefined;
    if (!groups.has(old)) groups.set(old, groupId());
    return groups.get(old);
  };
  const layerIds = new Set(doc.scene.layers.map((l) => l.id));
  const layer = (old: string | undefined) =>
    options.layer ?? (old !== undefined && layerIds.has(old) ? old : doc.scene.layers[0]!.id);
  const remap = (ref: string) => ids.get(ref) ?? ref;
  const shapes: MapShape[] = clip.shapes.map((s) => {
    const moved = applyXform(s, translateXform(offset[0], offset[1]));
    const base = {
      ...moved,
      id: ids.get(s.id)!,
      layer: layer(s.layer),
      group: g(s.group),
    };
    if (base.t === 'connector') {
      return clean({
        ...base,
        from: { ...base.from, ...(base.from.ref ? { ref: remap(base.from.ref) } : {}) },
        to: { ...base.to, ...(base.to.ref ? { ref: remap(base.to.ref) } : {}) },
      });
    }
    if (base.t === 'text' && base.anchor) {
      const copiedAnchor = ids.has(base.anchor.ref);
      return clean(
        copiedAnchor
          ? { ...base, anchor: { ...base.anchor, ref: remap(base.anchor.ref) } }
          : {
              ...base,
              anchor: {
                ...base.anchor,
                dx: base.anchor.dx + offset[0],
                dy: base.anchor.dy + offset[1],
              },
            },
      );
    }
    return clean(base);
  });
  const pins: MapPin[] = clip.pins.map((p) => ({
    ...p,
    id: ids.get(p.id)!,
    mapId: options.mapId,
    x: round1(p.x + offset[0]),
    y: round1(p.y + offset[1]),
    props: clean({ ...p.props, layer: layer(p.props.layer), group: g(p.props.group) }),
    createdAt: options.now,
    updatedAt: options.now,
  }));
  return {
    doc: {
      scene: { ...doc.scene, shapes: [...doc.scene.shapes, ...shapes] },
      pins: [...doc.pins, ...pins],
    },
    ids: [...shapes.map((s) => s.id), ...pins.map((p) => p.id)],
  };
}

export function makePin(
  mapId: string,
  id: string,
  x: number,
  y: number,
  layer: string,
  extra: Partial<Pick<MapPin, 'label' | 'color' | 'note'>> & { props?: PinProps } = {},
): MapPin {
  const now = new Date().toISOString();
  return {
    id,
    mapId,
    x: round1(x),
    y: round1(y),
    label: extra.label ?? '',
    color: extra.color ?? 'moss',
    note: extra.note ?? '',
    props: { ...(extra.props ?? {}), layer },
    target: null,
    createdAt: now,
    updatedAt: now,
  };
}
