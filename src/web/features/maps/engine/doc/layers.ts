/** Layers: add, change, reorder, remove, and move objects between them. */
import type { MapLayer } from '@shared/schemas/map';
import { clean } from '../shapes';
import { layerId, type Doc } from './model';

export function addLayer(doc: Doc, name: string, id = layerId()): Doc {
  return {
    ...doc,
    scene: {
      ...doc.scene,
      layers: [...doc.scene.layers, { id, name: name.slice(0, 40) || 'Layer' }],
    },
  };
}

export function updateLayer(doc: Doc, id: string, patch: Partial<MapLayer>): Doc {
  const layers = doc.scene.layers.map((l) => (l.id === id ? clean({ ...l, ...patch }) : l));
  return { ...doc, scene: { ...doc.scene, layers } };
}

/** Move a layer up (towards the top of the stack) or down. */
export function moveLayer(doc: Doc, id: string, direction: 1 | -1): Doc {
  const layers = [...doc.scene.layers];
  const i = layers.findIndex((l) => l.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= layers.length) return doc;
  [layers[i], layers[j]] = [layers[j]!, layers[i]!];
  return { ...doc, scene: { ...doc.scene, layers } };
}

/** Delete a layer; what was on it moves to the layer below (or above, for the bottom one). */
export function removeLayer(doc: Doc, id: string): Doc {
  const layers = doc.scene.layers;
  if (layers.length <= 1) return doc;
  const i = layers.findIndex((l) => l.id === id);
  const target = (layers[i - 1] ?? layers[i + 1])!;
  return {
    scene: {
      ...doc.scene,
      layers: layers.filter((l) => l.id !== id),
      shapes: doc.scene.shapes.map((s) => (s.layer === id ? { ...s, layer: target.id } : s)),
    },
    pins: doc.pins.map((p) =>
      p.props.layer === id ? { ...p, props: { ...p.props, layer: target.id } } : p,
    ),
  };
}

export function moveToLayer(doc: Doc, ids: ReadonlySet<string>, layer: string): Doc {
  const shapes = doc.scene.shapes.map((s) => (ids.has(s.id) ? { ...s, layer } : s));
  const pins = doc.pins.map((p) => (ids.has(p.id) ? { ...p, props: { ...p.props, layer } } : p));
  return { scene: { ...doc.scene, shapes }, pins };
}

export const firstUnlockedLayer = (doc: Doc): string => {
  const open = [...doc.scene.layers].reverse().find((l) => !l.locked && !l.hidden);
  return (open ?? doc.scene.layers[0]!).id;
};
