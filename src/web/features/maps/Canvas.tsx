/**
 * The drawing surface: pan and zoom, every tool, selection and its handles, snapping and smart
 * guides. It edits through `ed` (history and saving live in the editor around it) and draws the
 * scene with the same component the exports use.
 *
 * This file owns the React state and the render. What a pointer does is in `canvas/`: `pointerDown`
 * picks the gesture, `pointerMove` previews it, `pointerUp` saves it.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from 'react';
import { expandGroups, isEditable, objectsOf, selectionBox } from './engine/doc';
import { frameFor } from './engine/frame';
import type { ObjInfo } from './engine/shapes';
import type { Guide } from './engine/snap';
import type { MPt, Pt } from './engine/vec';
import type { CanvasApi } from './editorTypes';
import { toScreen, toWorld } from './geometry';
import {
  GuideLines,
  Grid,
  PinRings,
  Rulers,
  SelectionFrame,
  SmartGuides,
  SnapMark,
  VertexHandles,
} from './Overlay';
import { SceneView } from './render/SceneView';
import { commitTextEdit, editStateFor } from './canvas/commitText';
import { DraftLayer } from './canvas/DraftLayer';
import { Marquee, Measure } from './canvas/Overlays';
import { onPointerDown } from './canvas/pointerDown';
import { onPointerMove } from './canvas/pointerMove';
import { onPointerUp } from './canvas/pointerUp';
import { finishPolygon } from './canvas/tap';
import { TextEditor } from './canvas/TextEditor';
import type { CanvasEnv, Draft, Drag, PinchGesture, TextEdit } from './canvas/types';
import { useTextEditRequest } from './canvas/useTextEditRequest';
import { viewAfterWheel } from './canvas/wheel';

/** The mouse cursor each tool shows over the canvas. */
function cursorFor(tool: CanvasApi['tool'], spaceDown: boolean): string {
  if (tool === 'hand' || spaceDown) return 'grab';
  if (tool === 'select') return 'default';
  if (tool === 'text' || tool === 'note') return 'text';
  return 'crosshair';
}

export function Canvas({ ed }: { ed: CanvasApi }) {
  const { doc, view, size, tool, settings } = ed;
  const element = useRef<HTMLDivElement>(null);
  // Handlers run later than the render that made them; this gives them the latest editor state.
  const edRef = useRef(ed);
  useEffect(() => {
    edRef.current = ed;
  });
  const objs = useMemo(() => objectsOf(doc, view.scale), [doc, view.scale]);

  const pointers = useRef(new Map<number, Pt>());
  const pinch = useRef<PinchGesture | null>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [mark, setMark] = useState<MPt | null>(null);
  const [edit, setEdit] = useState<TextEdit | null>(null);
  const [cursor, setCursor] = useState<MPt | null>(null);
  const [guideDraft, setGuideDraft] = useState<{ axis: 'x' | 'y'; pos: number } | null>(null);

  // What is selected and may be changed, and the frame drawn round it.
  const selected = ed.selection;
  const selectedInfos = useMemo(
    () => [...selected].map((id) => objs.get(id)).filter((i): i is ObjInfo => i !== undefined),
    [selected, objs],
  );
  const editableSel = useMemo(
    () => selectedInfos.filter((i) => isEditable(doc, i)),
    [selectedInfos, doc],
  );
  const selectionBounds = useMemo(
    () =>
      selectionBox(
        objs,
        editableSel.map((i) => i.id),
      ),
    [objs, editableSel],
  );
  const frame = useMemo(
    () =>
      selectionBounds && editableSel.length > 0 ? frameFor(editableSel, selectionBounds) : null,
    [selectionBounds, editableSel],
  );
  const onlyInfo = editableSel.length === 1 ? editableSel[0] : undefined;
  const vertexInfo =
    onlyInfo?.shape &&
    (onlyInfo.shape.t === 'polygon' ||
      onlyInfo.shape.t === 'path' ||
      onlyInfo.shape.t === 'connector')
      ? onlyInfo
      : undefined;
  const onlyPinsSelected = editableSel.every((i) => i.kind === 'pin');

  const env: CanvasEnv = {
    getApi: () => edRef.current,
    getElement: () => element.current,
    drag,
    pointers,
    pinch,
    snapshot: { doc, objs, frame, editableSel, onlyInfo, draft },
    setDraft,
    setGuides,
    setMark,
    setEdit,
    setGuideDraft,
  };

  // The status bar shows where the pointer is, in map units.
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const move = (e: globalThis.PointerEvent) => {
      const rect = el.getBoundingClientRect();
      setCursor(
        toWorld(
          edRef.current.view,
          edRef.current.size,
          e.clientX - rect.left,
          e.clientY - rect.top,
        ),
      );
    };
    const leave = () => {
      setCursor(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, []);
  useEffect(() => {
    edRef.current.onCursor(cursor);
  }, [cursor]);

  useTextEditRequest(ed, objs, setEdit);

  // Keys that belong to an unfinished area: Enter finishes it, Escape drops it, Backspace undoes a corner.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (edit) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (draft?.k !== 'poly') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finishPolygon(env, draft.pts);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setDraft(null);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        const next = draft.pts.slice(0, -1);
        setDraft(next.length === 0 ? null : { ...draft, pts: next });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finishPolygon only uses refs and stable setters
  }, [draft, edit]);

  // Switching tools drops an unfinished area.
  if (tool !== 'polygon' && draft?.k === 'poly') setDraft(null);

  const onWheel = (e: WheelEvent) => {
    const rect = element.current?.getBoundingClientRect();
    if (!rect) return;
    const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    ed.setView((v) => viewAfterWheel(v, size, e, pointer));
  };

  /** The object under the pointer. Pointer capture sends clicks to the canvas itself, so look by position. */
  const objectIdAt = (e: {
    clientX: number;
    clientY: number;
    target: EventTarget;
  }): string | null => {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const id = el.closest('[data-oid]')?.getAttribute('data-oid');
      if (id) return id;
    }
    return (e.target as Element).closest('[data-oid]')?.getAttribute('data-oid') ?? null;
  };

  const onDoubleClick = (e: MouseEvent) => {
    const api = edRef.current;
    if (draft?.k === 'poly') {
      // The double-click's first click already added a corner; drop it unless that leaves too few.
      const withoutLast = draft.pts.slice(0, -1);
      finishPolygon(env, withoutLast.length >= 3 ? withoutLast : draft.pts);
      return;
    }
    const id = objectIdAt(e);
    const info = id ? objs.get(id) : undefined;
    if (!info || !isEditable(api.docRef.current, info)) return;
    if (info.kind === 'pin') {
      api.openPin(info.id);
      return;
    }
    const next = editStateFor(info.shape, info.id);
    if (next) setEdit(next);
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const api = edRef.current;
    const id = objectIdAt(e);
    const info = id ? objs.get(id) : undefined;
    if (info && !api.selection.has(info.id)) api.setSelection(expandGroups(objs, [info.id]));
    api.openMenu({ x: e.clientX, y: e.clientY }, info ? info.id : null);
  };

  const finishTextEdit = (text: string) => {
    const current = edit;
    setEdit(null);
    if (current) commitTextEdit(edRef.current, current, text);
  };

  const toScr = (x: number, y: number): MPt => toScreen(view, size, x, y);
  const worldTransform = `translate(${size.w / 2} ${size.h / 2}) scale(${view.scale}) translate(${-view.cx} ${-view.cy})`;
  const inSelectMode = tool === 'select';

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a pointer drawing surface; every action also has a button or key in the toolbar
    <div
      ref={element}
      data-testid="map-canvas"
      role="application"
      aria-roledescription="map canvas"
      aria-label="Map canvas"
      className="relative h-full min-h-[320px] touch-none overflow-hidden bg-surface select-none"
      style={{ cursor: cursorFor(tool, ed.spaceDown) }}
      onPointerDown={(e) => {
        onPointerDown(env, e);
      }}
      onPointerMove={(e) => {
        onPointerMove(env, e);
      }}
      onPointerUp={(e) => {
        onPointerUp(env, e);
      }}
      onPointerCancel={(e) => {
        onPointerUp(env, e);
      }}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <svg
        width={size.w}
        height={size.h}
        className="absolute inset-0"
        role="group"
        aria-label="Map drawing"
      >
        {settings.grid ? <Grid view={view} size={size} /> : null}
        <g transform={worldTransform}>
          <SceneView
            doc={doc}
            objs={objs}
            scale={view.scale}
            toScreen={toScr}
            markerTypes={ed.markerTypes}
            labels={settings.names}
          />
          <DraftLayer
            draft={draft}
            doc={doc}
            scale={view.scale}
            draw={ed.draw}
            markerTypes={ed.markerTypes}
          />
        </g>
        <GuideLines
          guides={[...(doc.scene.guides ?? []), ...(guideDraft ? [guideDraft] : [])]}
          view={view}
          size={size}
        />
        {draft?.k === 'measure' ? (
          <Measure a={draft.a} b={draft.b} view={view} size={size} doc={doc} />
        ) : null}
        {draft?.k === 'marquee' ? (
          <Marquee a={draft.a} b={draft.b} view={view} size={size} />
        ) : null}
        {inSelectMode && editableSel.length > 0 && onlyPinsSelected ? (
          <PinRings infos={editableSel} view={view} size={size} />
        ) : null}
        {inSelectMode && frame && !onlyPinsSelected ? (
          <SelectionFrame
            frame={frame}
            view={view}
            size={size}
            canRotate={editableSel.some((i) => i.kind === 'shape')}
            resizable={
              editableSel.some((i) => i.shape?.t !== 'connector') || editableSel.length > 1
            }
          />
        ) : null}
        {inSelectMode && vertexInfo ? (
          <VertexHandles info={vertexInfo} objs={objs} view={view} size={size} />
        ) : null}
        <SmartGuides guides={guides} view={view} size={size} />
        {mark ? <SnapMark pt={mark} view={view} size={size} /> : null}
        {settings.rulers ? <Rulers view={view} size={size} /> : null}
      </svg>

      {edit ? (
        <TextEditor
          edit={edit}
          objs={objs}
          view={view}
          size={size}
          onCommit={finishTextEdit}
          onCancel={() => {
            setEdit(null);
          }}
        />
      ) : null}
    </div>
  );
}
