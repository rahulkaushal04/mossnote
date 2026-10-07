/**
 * The in-memory clipboard for copied objects and copied styles. Not the system clipboard, so it
 * never leaves the page.
 */
import type { MapStyle } from '@shared/schemas/map';
import type { Clip } from './engine/doc';

/** Kept for the whole visit, so copy in one map and paste in another works. */
let clip: Clip | null = null;
let style: MapStyle | null = null;

export const getClip = (): Clip | null => clip;
export const setClip = (c: Clip | null): void => {
  clip = c;
};
export const getStyleClip = (): MapStyle | null => style;
export const setStyleClip = (s: MapStyle | null): void => {
  style = s;
};
