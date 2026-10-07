/**
 * The inspector: context-sensitive controls beside the canvas. With nothing selected it edits the
 * defaults for new drawings; with a selection it edits that selection.
 */
import { LIMITS } from '@shared/constants';
import type { MapStyle } from '@shared/schemas/map';
import { ColorPicker } from './ColorPicker';
import { StylePresets } from './StylePresets';
import { isPinId, setNote, setStyle, type Doc } from './engine/doc';
import type { Objects } from './engine/shapes';
import type { Actions, DrawStyle } from './editorTypes';
import { DrawingDefaults } from './inspector/DrawingDefaults';
import { kindLabel } from './inspector/labels';
import { BUTTON_CLASS, FIELD_CLASS, Section } from './inspector/parts';
import {
  ArrangeSection,
  ConnectorSection,
  CornersSection,
  MeasureSection,
  NoteSection,
  TextSection,
  type PatchShapes,
} from './inspector/sections';
import { StyleControls } from './inspector/StyleControls';

export interface InspectorProps {
  doc: Doc;
  objs: Objects;
  /** Selected objects the person may change. */
  ids: string[];
  draw: DrawStyle;
  setDraw: (patch: Partial<DrawStyle>) => void;
  commit: (fn: (d: Doc) => Doc, options?: { coalesce?: string }) => void;
  actions: Actions;
  onOpenPin: (id: string) => void;
  onManageTypes: () => void;
  onAddSuggestedLayers: () => void;
}

export function Inspector(props: InspectorProps) {
  if (props.ids.length === 0) return <DrawingDefaults {...props} />;
  return <SelectionInspector {...props} />;
}

/** The style a selection shows: its first shape's, or the first marker's colour. */
function selectionStyle(doc: Doc, ids: ReadonlySet<string>): MapStyle {
  const firstShape = doc.scene.shapes.find((s) => ids.has(s.id));
  if (firstShape) return firstShape.style;
  return {
    stroke: doc.pins.find((p) => ids.has(p.id))?.color ?? 'ink',
    fill: null,
    width: 3,
    dash: 'solid',
  };
}

function SelectionInspector({ doc, objs, ids, commit, actions, onOpenPin }: InspectorProps) {
  const selected = new Set(ids);
  const single = ids.length === 1 ? (objs.get(ids[0]!) ?? null) : null;
  const shapes = doc.scene.shapes.filter((s) => selected.has(s.id));
  const onlyPins = shapes.length === 0;
  const allText = shapes.length > 0 && shapes.every((s) => s.t === 'text');
  const allLocked = ids.every((id) => objs.get(id)?.locked);

  const applyStyle = (patch: Partial<MapStyle>) => {
    commit((d) => setStyle(d, selected, patch), { coalesce: 'style' });
  };
  const patchShapes: PatchShapes = (fn, key = 'shape') => {
    commit(
      (d) => ({
        ...d,
        scene: {
          ...d.scene,
          shapes: d.scene.shapes.map((s) => (selected.has(s.id) ? fn(s) : s)),
        },
      }),
      { coalesce: key },
    );
  };

  const singleShape = single?.shape;
  const connector = singleShape?.t === 'connector' ? singleShape : null;
  const text = singleShape?.t === 'text' ? singleShape : null;
  const rect = singleShape?.t === 'rect' ? singleShape : null;
  const polygon = singleShape?.t === 'polygon' ? singleShape : null;

  const singleIsPin = single ? isPinId(doc, single.id) : false;
  const name = singleIsPin ? (single?.pin?.label ?? '') : (singleShape?.name ?? '');
  const noteValue = singleIsPin ? (single?.pin?.note ?? '') : (singleShape?.note ?? '');
  const heading = !single
    ? `${ids.length} objects`
    : single.kind === 'pin'
      ? 'Marker'
      : kindLabel(singleShape);
  const style = selectionStyle(doc, selected);

  return (
    <div className="flex flex-col gap-4">
      <Section title={heading}>
        {single ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Name</span>
            <input
              key={single.id + name}
              defaultValue={name}
              maxLength={LIMITS.shapeName}
              placeholder="Unnamed"
              onBlur={(e) => {
                if (e.target.value !== name) actions.setName(single.id, e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className={FIELD_CLASS}
            />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-1">
          <button type="button" className={BUTTON_CLASS} onClick={actions.duplicate}>
            Duplicate
          </button>
          <button
            type="button"
            className={BUTTON_CLASS}
            aria-pressed={allLocked}
            onClick={() => {
              actions.setLocked(!allLocked);
            }}
          >
            {allLocked ? 'Unlock' : 'Lock'}
          </button>
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={() => {
              actions.setHidden(true);
            }}
          >
            Hide
          </button>
          {ids.length > 1 ? (
            <button type="button" className={BUTTON_CLASS} onClick={actions.group}>
              Group
            </button>
          ) : null}
          <button type="button" className={BUTTON_CLASS} onClick={actions.ungroup}>
            Ungroup
          </button>
          <button type="button" className={`${BUTTON_CLASS} text-danger`} onClick={actions.remove}>
            Delete
          </button>
        </div>
        {single?.kind === 'pin' ? (
          <button
            type="button"
            className={`${BUTTON_CLASS} self-start`}
            onClick={() => {
              onOpenPin(single.id);
            }}
          >
            Details, icon, tags, link…
          </button>
        ) : null}
      </Section>

      {onlyPins ? (
        <Section title="Colour">
          <ColorPicker
            value={style.stroke}
            label="Marker colour"
            onPick={(color) => {
              if (color) applyStyle({ stroke: color });
            }}
          />
        </Section>
      ) : (
        <Section title="Style">
          <StyleControls style={style} onChange={applyStyle} showFill={!connector} />
          <div className="flex gap-1">
            <button type="button" className={BUTTON_CLASS} onClick={actions.copyStyle}>
              Copy style
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={!actions.canPasteStyle}
              onClick={actions.pasteStyle}
            >
              Paste style
            </button>
          </div>
          <StylePresets current={style} onApply={applyStyle} />
        </Section>
      )}

      {connector ? <ConnectorSection connector={connector} patch={patchShapes} /> : null}
      {allText ? <TextSection text={text} patch={patchShapes} /> : null}
      {rect ? <CornersSection rect={rect} patch={patchShapes} /> : null}
      {single ? (
        <NoteSection
          object={single}
          noteValue={noteValue}
          onSaveNote={(note) => {
            commit((d) => setNote(d, single.id, note));
          }}
          onAddNoteCard={actions.addNote}
        />
      ) : null}
      {polygon ? <MeasureSection polygon={polygon} scale={doc.scene.scale} /> : null}
      <ArrangeSection count={ids.length} actions={actions} />
    </div>
  );
}
