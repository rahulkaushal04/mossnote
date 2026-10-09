/**
 * Create and edit marker types: name, icon, colour and the fields each carries.
 */
import { MAP_ICONS, type MapIcon } from '@shared/constants';
import { SUGGESTED_MARKER_TYPES } from '@shared/mapDefaults';
import type { MapMarkerType } from '@shared/schemas/map';
import { ulid } from 'ulid';
import { Dialog } from '../../components/ui/Dialog';
import { useSettings, useUpdateSettings } from '../settings/useSettings';
import { ColorPicker } from './ColorPicker';
import { ICON_LABELS, MarkerGlyph } from './render/MarkerGlyph';

const LIMIT = 50;

/**
 * Your own marker types: a name, an icon and a colour. Nothing is created for you; the suggested
 * ones are plain words you can add with a click.
 */
export function MarkerTypesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings();
  const update = useUpdateSettings();
  const types: MapMarkerType[] = settings.data?.markerTypes ?? [];
  const save = (next: MapMarkerType[]) => {
    update.mutate({ markerTypes: next });
  };
  const patch = (id: string, p: Partial<MapMarkerType>) => {
    save(types.map((t) => (t.id === id ? { ...t, ...p } : t)));
  };
  const missing = SUGGESTED_MARKER_TYPES.filter(
    (s) => !types.some((t) => t.name.toLowerCase() === s.name.toLowerCase()),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Marker types"
      description="A type gives a marker its starting icon and colour. You can still change them on any marker."
      placement="right"
    >
      <ul aria-label="Marker types" className="m-0 flex list-none flex-col gap-4 p-0">
        {types.map((t) => (
          <li key={t.id} className="flex flex-col gap-2 border-b border-line pb-3">
            <div className="flex gap-2">
              <input
                aria-label="Type name"
                defaultValue={t.name}
                maxLength={30}
                className="field-input flex-1"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== '' && v !== t.name) patch(t.id, { name: v });
                }}
              />
              <button
                type="button"
                className="tap rounded-md px-2 text-sm text-danger underline"
                onClick={() => {
                  save(types.filter((x) => x.id !== t.id));
                }}
              >
                Delete
              </button>
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label={`Icon for ${t.name}`}>
              {MAP_ICONS.map((icon: MapIcon) => (
                <button
                  key={icon}
                  type="button"
                  aria-label={ICON_LABELS[icon]}
                  aria-pressed={t.icon === icon}
                  title={ICON_LABELS[icon]}
                  onClick={() => {
                    patch(t.id, { icon });
                  }}
                  className={`tap flex size-8 items-center justify-center rounded-md border ${t.icon === icon ? 'border-accent bg-surface' : 'border-line'}`}
                >
                  <svg width={18} height={18} viewBox="-12 -12 24 24" aria-hidden="true">
                    <g color="var(--ink)">
                      <MarkerGlyph icon={icon} size={18} />
                    </g>
                  </svg>
                </button>
              ))}
            </div>
            <ColorPicker
              value={t.color}
              label={`Colour for ${t.name}`}
              onPick={(c) => {
                if (c) patch(t.id, { color: c });
              }}
            />
          </li>
        ))}
      </ul>
      {types.length === 0 ? (
        <p className="text-ink-muted">No types yet. Add your own, or start from a suggestion.</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn tap"
          disabled={types.length >= LIMIT}
          onClick={() => {
            save([...types, { id: ulid(), name: 'New type', icon: 'pin', color: 'moss' }]);
          }}
        >
          New type
        </button>
        {missing.map((s) => (
          <button
            key={s.name}
            type="button"
            className="btn tap"
            disabled={types.length >= LIMIT}
            onClick={() => {
              save([...types, { ...s, id: ulid() }]);
            }}
          >
            Add “{s.name}”
          </button>
        ))}
      </div>
      {update.isError ? (
        <p role="alert" className="mt-2 text-danger">
          Couldn&apos;t save that change.
        </p>
      ) : null}
    </Dialog>
  );
}
