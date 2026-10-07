/**
 * The things a person can do to the selection (duplicate, group, align, copy, paste, style, ...),
 * built once and shared by the toolbar, the inspector, the context menu and the keyboard.
 */
import { ulid } from 'ulid';
import type { MapShape, MapStyle } from '@shared/schemas/map';
import { getClip, getStyleClip, setClip, setStyleClip } from '../clipboardStore';
import type { Actions } from '../editorTypes';
import { sameSizeScales } from '../engine/align';
import {
  addShapes,
  alignObjects,
  copyObjects,
  distributeObjects,
  expandGroups,
  group,
  isEditable,
  moveObjects,
  objectsOf,
  pasteClip,
  removeObjects,
  renameObject,
  reorder,
  scaleObjects,
  selectionBox,
  setFlag,
  setStyle,
  ungroup,
  unitsOf,
  type Clip,
  type Doc,
} from '../engine/doc';
import { makeText } from '../engine/make';
import { clean, textTopLeftForCenter, type Objects } from '../engine/shapes';
import { gridStep } from '../engine/snap';
import { round1 } from '../engine/vec';
import { fitView, type Size, type View } from '../geometry';

/** Where a pasted copy lands when no pointer position is known, as an offset from the original. */
const PASTE_OFFSET: [number, number] = [20, 20];
/** How far above an object (screen px) a new note card sits. */
const NOTE_CARD_GAP_PX = 56;

export interface ActionDeps {
  mapId: string;
  doc: Doc;
  docRef: { current: Doc };
  commit: (fn: (d: Doc) => Doc, options?: { coalesce?: string }) => void;
  objs: Objects;
  /** Selected objects that exist. */
  ids: string[];
  /** Selected objects the person may change. */
  editableIds: string[];
  selection: ReadonlySet<string>;
  setSelection: (ids: Iterable<string>) => void;
  /** The layer new things go on, and whether it may be drawn on. */
  layer: string;
  layerUsable: boolean;
  /** The pointer's position on the map, for pasting where it is. */
  cursor: readonly [number, number] | null;
  view: View;
  size: Size;
  setView: (view: View) => void;
  say: (message: string) => void;
  lastMarker: string | null;
  setLastMarker: (id: string | null) => void;
  closePinSheet: () => void;
  showInspector: () => void;
  editText: (id: string) => void;
}

export interface EditorActions {
  actions: Actions;
  /** Paste a clip so its middle lands on `at`, or offset a little when there is no `at`. */
  pasteAt: (clip: Clip, at: readonly [number, number] | null) => void;
}

export function useEditorActions(deps: ActionDeps): EditorActions {
  const { doc, docRef, commit, objs, ids, editableIds, selection, setSelection } = deps;

  const editableSet = () => new Set(editableIds);
  /** Copy of the editable selection, with every group it touches. */
  const clipOfSelection = () => copyObjects(docRef.current, expandGroups(objs, editableIds));

  const pasteAt = (clip: Clip, at: readonly [number, number] | null) => {
    const bounds = selectionBox(
      objectsOf({ scene: { ...docRef.current.scene, shapes: clip.shapes }, pins: clip.pins }),
      [...clip.shapes.map((s) => s.id), ...clip.pins.map((p) => p.id)],
    );
    const offset: [number, number] =
      bounds && at
        ? [
            round1(at[0] - (bounds.minX + bounds.maxX) / 2),
            round1(at[1] - (bounds.minY + bounds.maxY) / 2),
          ]
        : PASTE_OFFSET;
    let created: string[] = [];
    commit((d) => {
      const result = pasteClip(d, clip, offset, {
        layer: deps.layerUsable ? deps.layer : undefined,
        newPinId: ulid,
        mapId: deps.mapId,
        now: new Date().toISOString(),
      });
      created = result.ids;
      return result.doc;
    });
    setSelection(created);
  };

  const remove = () => {
    if (editableIds.length === 0) return;
    const doomed = expandGroups(objs, editableIds);
    commit((d) =>
      removeObjects(
        d,
        new Set(
          [...doomed].filter((id) => {
            const info = objectsOf(d).get(id);
            return info && isEditable(d, info);
          }),
        ),
      ),
    );
    setSelection([]);
    deps.closePinSheet();
    if (deps.lastMarker && doomed.has(deps.lastMarker)) deps.setLastMarker(null);
  };

  /** Pin a card to an object; it follows the object when that moves. */
  const addNote = (id: string) => {
    const info = objs.get(id);
    if (!info) return;
    const card = makeText(
      [0, 0],
      'Note',
      'card',
      { stroke: 'ink', fill: null, width: 2, dash: 'solid' },
      deps.layer,
    );
    const [x, y] = textTopLeftForCenter(card, [
      info.center[0],
      info.box.minY - NOTE_CARD_GAP_PX / deps.view.scale,
    ]);
    const anchored: MapShape = {
      ...card,
      x,
      y,
      anchor: {
        ref: id,
        dx: round1(x + 90 - info.center[0]),
        dy: round1(y + 30 - info.center[1]),
      },
    };
    commit((d) => addShapes(d, [clean(anchored)]));
    setSelection([anchored.id]);
    deps.editText(anchored.id);
  };

  const sameSize = (mode: 'w' | 'h') => {
    commit((d) => {
      const all = objectsOf(d);
      const units = unitsOf(all, expandGroups(all, editableIds));
      let out = d;
      for (const [id, factor] of sameSizeScales(units, mode)) {
        const unit = units.find((u) => u.ids.includes(id));
        // One scale per unit, applied from its first member.
        if (unit?.ids[0] !== id) continue;
        const centre: [number, number] = [
          (unit.box.minX + unit.box.maxX) / 2,
          (unit.box.minY + unit.box.maxY) / 2,
        ];
        out = scaleObjects(
          out,
          new Set(unit.ids),
          centre,
          mode === 'w' ? factor : 1,
          mode === 'h' ? factor : 1,
        );
      }
      return out;
    });
  };

  const copyStyle = () => {
    const shape = doc.scene.shapes.find((s) => selection.has(s.id));
    const pin = doc.pins.find((p) => selection.has(p.id));
    const copied: MapStyle | null = shape
      ? shape.style
      : pin
        ? { stroke: pin.color, fill: null, width: 3, dash: 'solid' }
        : null;
    setStyleClip(copied);
    deps.say(copied ? 'Style copied' : 'Nothing to copy');
  };

  const actions: Actions = {
    duplicate: () => {
      if (editableIds.length > 0) pasteAt(clipOfSelection(), null);
    },
    remove,
    copy: () => {
      if (editableIds.length === 0) return;
      setClip(clipOfSelection());
      deps.say('Copied');
    },
    cut: () => {
      if (editableIds.length === 0) return;
      setClip(clipOfSelection());
      remove();
    },
    paste: () => {
      const clip = getClip();
      if (clip) pasteAt(clip, deps.cursor);
    },
    selectAll: () => {
      setSelection(
        [...objs.values()]
          .filter(
            (info) =>
              !info.hidden &&
              isEditable(doc, info) &&
              !doc.scene.layers.find((l) => l.id === info.layer)?.hidden,
          )
          .map((info) => info.id),
      );
    },
    group: () => {
      commit((d) => group(d, editableSet()));
    },
    ungroup: () => {
      commit((d) => ungroup(d, editableSet()));
    },
    order: (order) => {
      commit((d) => reorder(d, editableSet(), order));
    },
    align: (kind) => {
      commit((d) => alignObjects(d, expandGroups(objectsOf(d), editableIds), kind));
    },
    distribute: (axis) => {
      commit((d) => distributeObjects(d, expandGroups(objectsOf(d), editableIds), axis));
    },
    sameSize,
    setLocked: (value) => {
      commit((d) => setFlag(d, editableSet(), 'locked', value));
    },
    setHidden: (value) => {
      commit((d) => setFlag(d, editableSet(), 'hidden', value));
      if (value) setSelection([]);
    },
    copyStyle,
    pasteStyle: () => {
      const style = getStyleClip();
      if (style) commit((d) => setStyle(d, editableSet(), style));
    },
    get canPasteStyle() {
      return getStyleClip() !== null;
    },
    get canPaste() {
      return getClip() !== null;
    },
    rename: () => {
      deps.showInspector();
      // Wait for the panel to render before focusing its name field.
      setTimeout(() => {
        document
          .querySelector<HTMLInputElement>('#map-panel input[placeholder="Unnamed"]')
          ?.focus();
      }, 60);
    },
    setName: (id, name) => {
      commit((d) => renameObject(d, id, name));
    },
    addNote,
    fitSelection: () => {
      const bounds = selectionBox(objs, ids);
      if (bounds) deps.setView(fitView(bounds, deps.size, 4));
    },
    nudge: (dx, dy, big) => {
      if (editableIds.length === 0) return;
      const step = big ? Math.max(10, gridStep(deps.view.scale)) : 1;
      commit((d) => moveObjects(d, expandGroups(objectsOf(d), editableIds), dx * step, dy * step), {
        coalesce: 'nudge',
      });
    },
  };

  return { actions, pasteAt };
}
