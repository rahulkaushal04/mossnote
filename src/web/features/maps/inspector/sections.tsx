/** The inspector's sections for a selection. Each takes only what it needs. */
import type { MapShape } from '@shared/schemas/map';
import { LIMITS } from '@shared/constants';
import { polygonArea } from '../engine/measure';
import type { Actions } from '../editorTypes';
import type { ObjInfo } from '../engine/shapes';
import { BUTTON_CLASS, ChoiceGroup, FIELD_CLASS, Row, Section } from './parts';

/** Updates every selected shape. `key` lets repeated edits of one field share an undo step. */
export type PatchShapes = (fn: (shape: MapShape) => MapShape, key?: string) => void;

type ShapeOf<T extends MapShape['t']> = Extract<MapShape, { t: T }>;

const ROUTES = [
  { value: 'straight', label: 'Straight' },
  { value: 'curve', label: 'Curved' },
  { value: 'elbow', label: 'Elbow' },
] as const;

const HEADS = [
  { value: 'none', label: 'None' },
  { value: 'end', label: 'One end' },
  { value: 'both', label: 'Both' },
] as const;

const TEXT_KINDS = [
  { value: 'plain', label: 'Text' },
  { value: 'card', label: 'Card' },
  { value: 'callout', label: 'Callout' },
  { value: 'sticky', label: 'Sticky' },
] as const;

/** Width a text object gets when it first becomes a card, callout or sticky note. */
const DEFAULT_CARD_WIDTH = 180;
const TEXT_SIZE_RANGE = { min: 6, max: 400 };

const ALIGNMENTS = [
  ['left', 'Left'],
  ['hcenter', 'Centre'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['vcenter', 'Middle'],
  ['bottom', 'Bottom'],
] as const;

export function ConnectorSection({
  connector,
  patch,
}: {
  connector: ShapeOf<'connector'>;
  patch: PatchShapes;
}) {
  return (
    <Section title="Connector">
      <Row label="Shape of the line">
        <ChoiceGroup
          label="Route"
          options={ROUTES}
          value={connector.route}
          onChange={(route) => {
            patch((s) => (s.t === 'connector' ? { ...s, route } : s), 'route');
          }}
        />
      </Row>
      <Row label="Arrowheads">
        <ChoiceGroup
          label="Arrowheads"
          options={HEADS}
          value={connector.head}
          onChange={(head) => {
            patch((s) => (s.t === 'connector' ? { ...s, head } : s), 'head');
          }}
        />
      </Row>
      <button
        type="button"
        className={`${BUTTON_CLASS} self-start`}
        onClick={() => {
          patch((s) => (s.t === 'connector' ? { ...s, from: s.to, to: s.from } : s), 'reverse');
        }}
      >
        Reverse direction
      </button>
    </Section>
  );
}

export function TextSection({
  text,
  patch,
}: {
  /** The one selected text object, or null when several are selected. */
  text: ShapeOf<'text'> | null;
  patch: PatchShapes;
}) {
  return (
    <Section title="Text">
      {text ? (
        <Row label="Kind">
          <ChoiceGroup
            label="Text kind"
            wrap
            options={TEXT_KINDS}
            value={text.kind}
            onChange={(kind) => {
              patch(
                (s) =>
                  s.t === 'text'
                    ? {
                        ...s,
                        kind,
                        ...(kind === 'plain' ? { w: undefined } : { w: s.w ?? DEFAULT_CARD_WIDTH }),
                      }
                    : s,
                'kind',
              );
            }}
          />
        </Row>
      ) : null}
      <Row label="Size">
        <input
          type="number"
          min={TEXT_SIZE_RANGE.min}
          max={TEXT_SIZE_RANGE.max}
          value={Math.round(text?.size ?? 16)}
          onChange={(e) => {
            const size = Number(e.target.value);
            if (size >= TEXT_SIZE_RANGE.min && size <= TEXT_SIZE_RANGE.max) {
              patch((s) => (s.t === 'text' ? { ...s, size } : s), 'size');
            }
          }}
          className={FIELD_CLASS}
        />
      </Row>
    </Section>
  );
}

export function CornersSection({ rect, patch }: { rect: ShapeOf<'rect'>; patch: PatchShapes }) {
  return (
    <Section title="Corners">
      <input
        type="range"
        aria-label="Corner roundness"
        min={0}
        max={Math.round(Math.min(rect.w, rect.h) / 2)}
        value={rect.r ?? 0}
        onChange={(e) => {
          const r = Number(e.target.value);
          patch((s) => (s.t === 'rect' ? { ...s, r: r === 0 ? undefined : r } : s), 'radius');
        }}
      />
    </Section>
  );
}

export function NoteSection({
  object,
  noteValue,
  onSaveNote,
  onAddNoteCard,
}: {
  object: ObjInfo;
  noteValue: string;
  onSaveNote: (note: string) => void;
  onAddNoteCard: Actions['addNote'];
}) {
  const isPin = object.kind === 'pin';
  // A text object is already a note, so it does not offer a note card of its own.
  const canHaveNoteCard = isPin || object.shape?.t !== 'text';
  return (
    <Section title="Note on this object">
      <textarea
        key={object.id}
        defaultValue={noteValue}
        rows={3}
        maxLength={isPin ? LIMITS.pinNote : LIMITS.shapeNote}
        placeholder="A short note that stays with it"
        onBlur={(e) => {
          if (e.target.value !== noteValue) onSaveNote(e.target.value);
        }}
        className="w-full rounded-control border border-ink-muted bg-paper px-2 py-1 text-sm"
      />
      {canHaveNoteCard ? (
        <button
          type="button"
          className={`${BUTTON_CLASS} self-start`}
          onClick={() => {
            onAddNoteCard(object.id);
          }}
        >
          Pin a note card to it
        </button>
      ) : null}
    </Section>
  );
}

export function MeasureSection({
  polygon,
  scale,
}: {
  polygon: ShapeOf<'polygon'>;
  scale: { unit: string; size: number } | undefined;
}) {
  const area = polygonArea(polygon.pts);
  const cellArea = scale ? scale.size * scale.size : 1;
  return (
    <Section title="Measure">
      <p className="m-0 text-sm">
        Area: {Math.round(area / cellArea).toLocaleString()}{' '}
        {scale ? `${scale.unit}²` : 'square units'}
      </p>
    </Section>
  );
}

export function ArrangeSection({ count, actions }: { count: number; actions: Actions }) {
  return (
    <Section title="Arrange">
      <div className="flex flex-wrap gap-1">
        {(
          [
            ['front', 'To front'],
            ['forward', 'Forward'],
            ['backward', 'Backward'],
            ['back', 'To back'],
          ] as const
        ).map(([order, label]) => (
          <button
            key={order}
            type="button"
            className={BUTTON_CLASS}
            onClick={() => {
              actions.order(order);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {count > 1 ? (
        <>
          <div role="group" aria-label="Align" className="flex flex-wrap gap-1">
            {ALIGNMENTS.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className={BUTTON_CLASS}
                aria-label={`Align ${label.toLowerCase()}`}
                onClick={() => {
                  actions.align(kind);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Distribute and size" className="flex flex-wrap gap-1">
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={count < 3}
              onClick={() => {
                actions.distribute('h');
              }}
            >
              Space across
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={count < 3}
              onClick={() => {
                actions.distribute('v');
              }}
            >
              Space down
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() => {
                actions.sameSize('w');
              }}
            >
              Same width
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() => {
                actions.sameSize('h');
              }}
            >
              Same height
            </button>
          </div>
        </>
      ) : null}
    </Section>
  );
}
