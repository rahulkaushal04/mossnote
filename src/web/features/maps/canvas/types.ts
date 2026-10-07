/**
 * Shared types for the canvas modules.
 *
 * Two kinds of state meet here. A `Draft` is what is drawn while a gesture is under way (a stroke,
 * a shape being sized) and is React state, so it re-renders. A `Drag` is the bookkeeping for the
 * gesture itself and lives in a ref, because it changes on every pointer move.
 */
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { MapShape } from '@shared/schemas/map';
import type { CanvasApi } from '../editorTypes';
import type { Doc } from '../engine/doc';
import type { Frame, HandleId } from '../engine/frame';
import type { Guide, SnapContext, SnapSettings } from '../engine/snap';
import type { ObjInfo, Objects } from '../engine/shapes';
import type { Box, MPt, Pt } from '../engine/vec';
import type { View } from '../geometry';

/** Snap settings with everything off, used while Alt is held. */
export const SNAP_OFF: SnapSettings = { objects: false, align: false, grid: false, angle: false };

/** Something drawn while a gesture is in progress. */
export type Draft =
  | { k: 'stroke'; pts: MPt[] }
  | { k: 'shape'; shape: MapShape }
  | { k: 'poly'; pts: MPt[]; cursor: MPt | null }
  | { k: 'measure'; a: MPt; b: MPt }
  | { k: 'marquee'; a: MPt; b: MPt };

export type ShapeTool = 'line' | 'arrow' | 'rect' | 'ellipse' | 'connector';

/** What the pointer is doing between press and release. */
export type Drag =
  | { k: 'pan'; sx: number; sy: number; view: View }
  | { k: 'marquee'; a: MPt; additive: boolean; base: Set<string> }
  | {
      k: 'move';
      ids: Set<string>;
      start: MPt;
      box: Box;
      base: Doc;
      ctx: SnapContext;
      moved: boolean;
      /** The object that was pressed. */
      hit: string;
      shift: boolean;
      /** Set when a single marker is moved, which snaps by its point rather than its box. */
      single: string | null;
    }
  | { k: 'resize'; handle: HandleId; ids: Set<string>; base: Doc; frame: Frame }
  | { k: 'rotate'; ids: Set<string>; base: Doc; center: MPt; start: number }
  | { k: 'vertex'; id: string; index: number | 'from' | 'to'; base: Doc; ctx: SnapContext }
  | { k: 'bend'; id: string; base: Doc }
  | { k: 'stroke'; pts: MPt[] }
  | {
      k: 'shape';
      tool: ShapeTool;
      a: MPt;
      aRef: string | undefined;
      ctx: SnapContext;
      startPx: Pt;
    }
  | { k: 'measure'; a: MPt; ctx: SnapContext }
  | { k: 'tap'; sx: number; sy: number }
  | { k: 'newGuide'; axis: 'x' | 'y' }
  | { k: 'guide'; index: number; base: Doc };

/** A two-finger pan and pinch in progress. */
export interface PinchGesture {
  startDist: number;
  startView: View;
  startMid: Pt;
}

/** A text box open for typing. */
export interface TextEdit {
  /** Existing object being edited, or null for a new one. */
  id: string | null;
  at: MPt;
  kind: 'plain' | 'sticky';
  text: string;
}

/**
 * Everything a pointer handler needs. Built on each render; handlers call `getApi()` for the
 * latest editor state at event time and read `snapshot` for what was on screen at the last render.
 */
export interface CanvasEnv {
  getApi: () => CanvasApi;
  getElement: () => HTMLDivElement | null;
  drag: RefObject<Drag | null>;
  pointers: RefObject<Map<number, Pt>>;
  pinch: RefObject<PinchGesture | null>;
  snapshot: {
    doc: Doc;
    objs: Objects;
    frame: Frame | null;
    editableSel: ObjInfo[];
    onlyInfo: ObjInfo | undefined;
    draft: Draft | null;
  };
  setDraft: (draft: Draft | null) => void;
  setGuides: Dispatch<SetStateAction<Guide[]>>;
  setMark: (pt: MPt | null) => void;
  setEdit: (edit: TextEdit | null) => void;
  setGuideDraft: (guide: { axis: 'x' | 'y'; pos: number } | null) => void;
}
