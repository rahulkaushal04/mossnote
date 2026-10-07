import type { MapMarkerType, MapScene } from './schemas/map';

/** Plain starting points for maps. No zod here, so the web app can import it freely. */
export const EMPTY_SCENE_LAYER_ID = 'layer-1';

export const emptyScene = (): MapScene => ({
  v: 2,
  layers: [{ id: EMPTY_SCENE_LAYER_ID, name: 'Layer 1' }],
  shapes: [],
});

/** Layers offered as a starting point: plain vocabulary, created only when asked for. */
export const SUGGESTED_LAYERS = ['Background', 'Terrain', 'Paths', 'Locations', 'Notes'] as const;

export const layeredScene = (): MapScene => ({
  v: 2,
  layers: SUGGESTED_LAYERS.map((name, i) => ({ id: `layer-${i + 1}`, name })),
  shapes: [],
});

export const DEFAULT_STYLE = { stroke: 'ink', fill: null, width: 3, dash: 'solid' } as const;

/** Plain-word marker types offered as one-click additions. Never created automatically. */
export const SUGGESTED_MARKER_TYPES: readonly Omit<MapMarkerType, 'id'>[] = [
  { name: 'Important', icon: 'star', color: 'amber' },
  { name: 'Question', icon: 'question', color: 'sky' },
  { name: 'Person', icon: 'person', color: 'rose' },
  { name: 'Treasure', icon: 'diamond', color: 'plum' },
  { name: 'Entrance', icon: 'door', color: 'moss' },
  { name: 'Blocked', icon: 'cross', color: 'rose' },
  { name: 'Interesting', icon: 'eye', color: 'sky' },
];
