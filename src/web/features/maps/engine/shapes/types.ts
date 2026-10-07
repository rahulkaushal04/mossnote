import type { MapShape } from '@shared/schemas/map';
import type { MapPin } from '@shared/types';
import type { Box, MPt } from '../vec';

export type TextShape = Extract<MapShape, { t: 'text' }>;
export type ConnectorShape = Extract<MapShape, { t: 'connector' }>;

/** Pins keep one size on screen: a badge this many pixels across from its centre. */
export const PIN_R = 13;

/** One thing on the map, resolved to where it is: a shape or a pin, with its bounds and flags. */
export interface ObjInfo {
  id: string;
  kind: 'shape' | 'pin';
  shape?: MapShape;
  pin?: MapPin;
  layer: string;
  hidden: boolean;
  locked: boolean;
  group: string | undefined;
  /** Axis-aligned bounds in world units. */
  box: Box;
  center: MPt;
  /** Corners of the (possibly rotated) box, for rect, ellipse and text. */
  corners?: MPt[];
  /** For a pin: its radius in world units at the current zoom. */
  radius?: number;
}

/** Every object on the map by id. */
export type Objects = Map<string, ObjInfo>;
