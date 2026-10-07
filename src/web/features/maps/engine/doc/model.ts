/**
 * The document model: what the editor edits, and how new ids are made.
 *
 * A `Doc` is the drawing (scene) plus the pins. All editing functions in this folder are pure:
 * they take a `Doc` and return a new one, which is what makes undo, redo and tests simple.
 */
import type { MapScene, MapStyle } from '@shared/schemas/map';
import type { MapPin } from '@shared/types';

/** Everything the editor edits: the drawing and the pins. History and saving work on this. */
export interface Doc {
  scene: MapScene;
  pins: MapPin[];
}

export const DEFAULT_STYLE: MapStyle = { stroke: 'ink', fill: null, width: 3, dash: 'solid' };

let counter = 0;
/** Ids for drawn objects. Pins use ULIDs from the caller, because the server stores them. */
export const shapeId = (): string =>
  `s${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const groupId = (): string => `g${shapeId()}`;
export const layerId = (): string => `layer-${shapeId()}`;

export const isPinId = (doc: Doc, id: string): boolean => doc.pins.some((p) => p.id === id);
