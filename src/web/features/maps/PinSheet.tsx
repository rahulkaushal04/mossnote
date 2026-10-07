/**
 * The marker details sheet: name, icon, status, tags, fields, note, layer and link.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ulid } from 'ulid';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITS, MAP_ICONS, type MapIcon } from '@shared/constants';
import type { MapMarkerType, PinProps } from '@shared/schemas/map';
import type { LinkRef, MapPin, PickItem } from '@shared/types';
import { Dialog } from '../../components/ui/Dialog';
import { api } from '../../lib/api';
import { useCalendar } from '../calendar/CalendarProvider';
import { refreshNotes } from '../notes/hooks';
import { ColorPicker } from './ColorPicker';
import { ICON_LABELS, MarkerGlyph } from './render/MarkerGlyph';
import { pinLook } from './render/colors';

const KIND_LABEL = { note: 'Note', person: 'Person', planting: 'Farm entry', tag: 'Tag' } as const;
const LINK_PATH = { note: '/notes/', person: '/people/', planting: '/farm/' } as const;
const FIELD = 'tap w-full rounded-control border border-ink-muted bg-paper px-3';

/**
 * Link a marker to something already written, or write a new note on the spot: whatever is typed
 * is searched and can also be saved as a note, so a thought never needs a second screen.
 */
export function LinkPicker({ onLink }: { onLink: (target: LinkRef) => void }) {
  const calendar = useCalendar();
  const client = useQueryClient();
  const [text, setText] = useState('');
  const q = text.trim();
  const found = useQuery({
    queryKey: ['pick', 'any', q],
    queryFn: async ({ signal }): Promise<PickItem[]> =>
      (await api.pick('any', q, [], signal)).items,
    enabled: q !== '',
  });
  const items = (found.data ?? []).filter((i) => i.kind !== 'tag');
  const [busy, setBusy] = useState(false);

  const createNote = async () => {
    setBusy(true);
    try {
      const id = ulid();
      await api.createNote({
        id,
        body: q,
        ...(calendar.currentGameDate === null ? {} : { gameDate: calendar.currentGameDate }),
      });
      void refreshNotes(client);
      onLink({ type: 'note', id, label: q.slice(0, 80) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Link to a note, person or farm entry</span>
        <input
          value={text}
          placeholder="Search, or type a new note"
          onChange={(e) => {
            setText(e.target.value);
          }}
          className={FIELD}
        />
      </label>
      {q !== '' ? (
        <ul aria-label="Matches" className="m-0 flex list-none flex-col p-0">
          {items.slice(0, 6).map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <button
                type="button"
                className="tap flex w-full items-baseline justify-between gap-3 rounded-control px-2 text-left hover:bg-surface"
                onClick={() => {
                  if (item.kind !== 'tag')
                    onLink({ type: item.kind, id: item.id, label: item.label });
                }}
              >
                <span className="truncate">{item.label}</span>
                <span className="shrink-0 text-sm text-ink-muted">{KIND_LABEL[item.kind]}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              disabled={busy}
              className="tap w-full rounded-control px-2 text-left underline hover:bg-surface"
              onClick={() => void createNote()}
            >
              Save “{q.length > 40 ? `${q.slice(0, 40)}…` : q}” as a new note and link it
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

export interface PinSheetProps {
  pin: MapPin | null;
  layers: readonly { id: string; name: string }[];
  markerTypes: readonly MapMarkerType[];
  /** Statuses already used on this map, offered as suggestions. */
  statuses: readonly string[];
  open: boolean;
  onClose: () => void;
  onChange: (id: string, patch: Partial<Pick<MapPin, 'label' | 'color' | 'note'>>) => void;
  onProps: (id: string, patch: Partial<PinProps>) => void;
  onDelete: (id: string) => void;
  onLink: (pin: MapPin, target: LinkRef | null) => void;
  onManageTypes: () => void;
}

/** Everything about one marker. Changes apply as you make them. */
export function PinSheet(props: PinSheetProps) {
  const { pin, open, onClose } = props;
  return (
    <Dialog
      open={open && pin !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Marker"
      placement="right"
    >
      {pin ? <PinForm key={pin.id} {...props} pin={pin} /> : null}
    </Dialog>
  );
}

function PinForm({
  pin,
  layers,
  markerTypes,
  statuses,
  onClose,
  onChange,
  onProps,
  onDelete,
  onLink,
  onManageTypes,
}: PinSheetProps & { pin: MapPin }) {
  const [label, setLabel] = useState(pin.label);
  const [note, setNote] = useState(pin.note);
  const [tag, setTag] = useState('');
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (pin.label === '') labelRef.current?.focus();
  }, [pin.label]);
  const look = pinLook(pin, markerTypes);
  const tags = pin.props.tags ?? [];
  const fields = pin.props.fields ?? [];

  const addTag = () => {
    const value = tag.trim().replace(/^#/, '').slice(0, 30);
    setTag('');
    if (
      value === '' ||
      tags.some((t) => t.toLowerCase() === value.toLowerCase()) ||
      tags.length >= LIMITS.pinTags
    )
      return;
    onProps(pin.id, { tags: [...tags, value] });
  };
  const setFields = (next: { label: string; value: string }[]) => {
    onProps(pin.id, { fields: next.slice(0, LIMITS.pinFields) });
  };

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(pin.id, { label: label.trim(), note });
        onClose();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Name</span>
        <input
          ref={labelRef}
          value={label}
          maxLength={LIMITS.pinLabel}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
          onBlur={() => {
            if (label.trim() !== pin.label) onChange(pin.id, { label: label.trim() });
          }}
          className={FIELD}
        />
      </label>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label htmlFor="pin-type" className="font-semibold">
            Type
          </label>
          <button
            type="button"
            className="tap rounded-control px-2 text-sm underline"
            onClick={onManageTypes}
          >
            Edit types
          </button>
        </div>
        <select
          id="pin-type"
          value={pin.props.type ?? ''}
          onChange={(e) => {
            const type = markerTypes.find((t) => t.id === e.target.value);
            if (!type) {
              onProps(pin.id, { type: undefined });
              return;
            }
            onProps(pin.id, { type: type.id, icon: undefined });
            onChange(pin.id, { color: type.color });
          }}
          className={FIELD}
        >
          <option value="">None</option>
          {markerTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 font-semibold">Icon</legend>
        <div className="flex flex-wrap gap-1">
          {MAP_ICONS.map((icon: MapIcon) => (
            <button
              key={icon}
              type="button"
              aria-label={ICON_LABELS[icon]}
              aria-pressed={look.icon === icon}
              title={ICON_LABELS[icon]}
              onClick={() => {
                onProps(pin.id, { icon });
              }}
              className={`tap flex size-9 items-center justify-center rounded-control border ${look.icon === icon ? 'border-accent bg-surface' : 'border-rule'}`}
            >
              <svg width={22} height={22} viewBox="-12 -12 24 24" aria-hidden="true">
                <g color="var(--ink)">
                  <MarkerGlyph icon={icon} size={20} />
                </g>
              </svg>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <span className="font-semibold">Colour</span>
        <ColorPicker
          value={pin.color}
          label="Marker colour"
          onPick={(c) => {
            if (c) onChange(pin.id, { color: c });
          }}
        />
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-semibold">Status</span>
        <input
          list="pin-statuses"
          defaultValue={pin.props.status ?? ''}
          maxLength={LIMITS.pinStatus}
          placeholder="For example: to check, done"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (pin.props.status ?? ''))
              onProps(pin.id, { status: v === '' ? undefined : v });
          }}
          className={FIELD}
        />
        <datalist id="pin-statuses">
          {statuses.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>

      <div className="flex flex-col gap-1">
        <span className="font-semibold">Tags</span>
        <div className="flex flex-wrap items-center gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-control border border-rule px-2 text-sm"
            >
              #{t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                className="tap px-1"
                onClick={() => {
                  onProps(pin.id, { tags: tags.filter((x) => x !== t) });
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={tag}
            aria-label="Add a tag"
            placeholder="Add a tag"
            onChange={(e) => {
              setTag(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            className="tap w-28 rounded-control border border-rule bg-paper px-2 text-sm"
          />
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-semibold">Short note</span>
        <textarea
          value={note}
          rows={3}
          maxLength={LIMITS.pinNote}
          onChange={(e) => {
            setNote(e.target.value);
          }}
          onBlur={() => {
            if (note !== pin.note) onChange(pin.id, { note });
          }}
          className="w-full rounded-control border border-ink-muted bg-paper px-3 py-2"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="font-semibold">Custom fields</span>
        {fields.map((f, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label={`Field ${i + 1} label`}
              defaultValue={f.label}
              maxLength={LIMITS.customFieldLabel}
              placeholder="Label"
              className="tap w-2/5 rounded-control border border-rule bg-paper px-2"
              onBlur={(e) => {
                const next = fields
                  .map((x, j) => (j === i ? { ...x, label: e.target.value.trim() } : x))
                  .filter((x) => x.label !== '');
                setFields(next);
              }}
            />
            <input
              aria-label={`Field ${i + 1} value`}
              defaultValue={f.value}
              maxLength={LIMITS.customFieldValue}
              placeholder="Value"
              className="tap flex-1 rounded-control border border-rule bg-paper px-2"
              onBlur={(e) => {
                setFields(fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)));
              }}
            />
            <button
              type="button"
              aria-label={`Remove field ${i + 1}`}
              className="tap px-2"
              onClick={() => {
                setFields(fields.filter((_, j) => j !== i));
              }}
            >
              ×
            </button>
          </div>
        ))}
        {fields.length < LIMITS.pinFields ? (
          <button
            type="button"
            className="btn tap self-start text-sm"
            onClick={() => {
              setFields([...fields, { label: `Field ${fields.length + 1}`, value: '' }]);
            }}
          >
            Add a field
          </button>
        ) : null}
      </div>

      {layers.length > 1 ? (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Layer</span>
          <select
            value={pin.props.layer ?? layers[0]?.id}
            onChange={(e) => {
              onProps(pin.id, { layer: e.target.value });
            }}
            className={FIELD}
          >
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {pin.target ? (
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-muted">Linked to</span>
          <Link to={`${LINK_PATH[pin.target.type]}${pin.target.id}`}>{pin.target.label}</Link>
          <button
            type="button"
            className="tap rounded-control px-2 text-sm underline"
            onClick={() => {
              onLink(pin, null);
            }}
          >
            Unlink
          </button>
        </p>
      ) : (
        <LinkPicker
          onLink={(target) => {
            onLink(pin, target);
          }}
        />
      )}

      <div className="flex items-center justify-between">
        <button type="submit" className="btn btn-primary tap">
          Done
        </button>
        <button
          type="button"
          className="tap rounded-control px-2 text-danger underline"
          onClick={() => {
            onDelete(pin.id);
            onClose();
          }}
        >
          Delete marker
        </button>
      </div>
    </form>
  );
}
