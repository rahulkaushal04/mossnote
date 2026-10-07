/**
 * Types and defaults shared by the map editor and its canvas: tools, settings, drawing style, and
 * the `CanvasApi` and `Actions` contracts.
 */
import type { MapMarkerType, MapShape, MapStyle } from '@shared/schemas/map';
import type { Doc } from './engine/doc';
import type { SnapSettings } from './engine/snap';
import type { View } from './geometry';

export type Tool =
  | 'select'
  | 'hand'
  | 'draw'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'connector'
  | 'text'
  | 'note'
  | 'pin'
  | 'measure';

export interface ToolInfo {
  id: Tool;
  label: string;
  key: string;
  hint: string;
}

export const TOOLS: readonly ToolInfo[] = [
  {
    id: 'select',
    label: 'Select',
    key: 'V',
    hint: 'Click to select, drag to move, drag empty space to select several',
  },
  { id: 'hand', label: 'Pan', key: 'H', hint: 'Drag to move around the map' },
  {
    id: 'draw',
    label: 'Draw',
    key: 'B',
    hint: 'Draw freehand; rough shapes are tidied up for you',
  },
  { id: 'line', label: 'Line', key: 'L', hint: 'Drag from one point to another' },
  { id: 'arrow', label: 'Arrow', key: 'A', hint: 'Drag from the tail to the head' },
  { id: 'rect', label: 'Box', key: 'R', hint: 'Drag a rectangle; hold Shift for a square' },
  { id: 'ellipse', label: 'Circle', key: 'O', hint: 'Drag an oval; hold Shift for a circle' },
  {
    id: 'polygon',
    label: 'Area',
    key: 'Y',
    hint: 'Click the corners; double-click or Enter to finish',
  },
  {
    id: 'connector',
    label: 'Connect',
    key: 'C',
    hint: 'Drag from one object to another to join them',
  },
  { id: 'text', label: 'Text', key: 'T', hint: 'Click to type a label' },
  { id: 'note', label: 'Note', key: 'S', hint: 'Click to place a sticky note' },
  { id: 'pin', label: 'Marker', key: 'K', hint: 'Click to drop a marker' },
  { id: 'measure', label: 'Measure', key: 'M', hint: 'Drag to measure a distance' },
];

export interface EditorSettings {
  /** Tidy rough strokes into clean shapes. */
  smart: boolean;
  /** Master switch for every kind of snapping; Alt suspends it while held. */
  snap: boolean;
  snaps: SnapSettings;
  grid: boolean;
  rulers: boolean;
  minimap: boolean;
  /** Stay on a shape tool after drawing instead of going back to Select. */
  keepTool: boolean;
  names: boolean;
  compass: boolean;
}

export const DEFAULT_SETTINGS: EditorSettings = {
  smart: true,
  snap: true,
  snaps: { objects: true, align: true, grid: true, angle: true },
  grid: false,
  rulers: false,
  minimap: true,
  keepTool: false,
  names: true,
  compass: true,
};

export interface DrawStyle {
  stroke: string;
  fill: string | null;
  width: number;
  dash: MapStyle['dash'];
}

export const DEFAULT_DRAW: DrawStyle = { stroke: 'ink', fill: null, width: 3, dash: 'solid' };

/** What the canvas needs from the editor around it. */
export interface CanvasApi {
  mapId: string;
  doc: Doc;
  docRef: { current: Doc };
  view: View;
  setView: (next: View | ((v: View) => View)) => void;
  size: { w: number; h: number };
  tool: Tool;
  setTool: (t: Tool) => void;
  settings: EditorSettings;
  draw: DrawStyle;
  layer: string;
  markerTypes: readonly MapMarkerType[];
  selection: ReadonlySet<string>;
  setSelection: (ids: Iterable<string>) => void;
  commit: (fn: Doc | ((d: Doc) => Doc), options?: { coalesce?: string }) => void;
  live: (fn: (d: Doc) => Doc) => void;
  begin: () => void;
  end: () => void;
  cancel: () => void;
  newPinId: () => string;
  /** Tell the editor a shape was tidied, so it can offer to keep the original. */
  onCleanup: (info: { label: string; id: string; raw: MapShape }) => void;
  openPin: (id: string) => void;
  /** Cursor position in map units, or null when the pointer leaves, for the status bar. */
  onCursor: (pt: readonly [number, number] | null) => void;
  /** A short message for the person editing (a limit was reached). */
  notify: (message: string) => void;
  openMenu: (at: { x: number; y: number }, target: string | null) => void;
  /** After a shape tool finishes: return to Select unless the tool is kept. */
  finishTool: () => void;
  explore: boolean;
  /** Where the explorer last dropped a marker, so the next path can start there. */
  lastMarker: string | null;
  setLastMarker: (id: string | null) => void;
  /** Called with the new pin when one is placed, so a name can be typed at once. */
  onPinPlaced: (id: string) => void;
  /** Space is held: pan with the pointer whatever the tool. */
  spaceDown: boolean;
  /** Ask the canvas to start editing this text object (after adding a note card). */
  editTextId: string | null;
  onEditStarted: () => void;
}

/** Things the person can do to the selection, shared by the toolbar, menus and keys. */
export interface Actions {
  duplicate: () => void;
  remove: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  selectAll: () => void;
  group: () => void;
  ungroup: () => void;
  order: (o: 'front' | 'back' | 'forward' | 'backward') => void;
  align: (k: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void;
  distribute: (axis: 'h' | 'v') => void;
  sameSize: (mode: 'w' | 'h') => void;
  setLocked: (v: boolean) => void;
  setHidden: (v: boolean) => void;
  copyStyle: () => void;
  pasteStyle: () => void;
  canPasteStyle: boolean;
  canPaste: boolean;
  /** Focus the name field in the inspector. */
  rename: () => void;
  setName: (id: string, name: string) => void;
  /** Add a note card attached to the object. */
  addNote: (id: string) => void;
  fitSelection: () => void;
  nudge: (dx: number, dy: number, big: boolean) => void;
}
