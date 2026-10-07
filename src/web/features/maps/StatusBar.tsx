/**
 * The status bar (pointer position, zoom, snap and display toggles) and the compass.
 */
import type { EditorSettings } from './editorTypes';

/** Cursor position, zoom, and the switches people reach for most. */
export function StatusBar({
  cursor,
  zoom,
  unit,
  settings,
  onChange,
  onZoomReset,
  saved,
}: {
  cursor: readonly [number, number] | null;
  zoom: number;
  unit: { unit: string; size: number } | undefined;
  settings: EditorSettings;
  onChange: (p: Partial<EditorSettings>) => void;
  onZoomReset: () => void;
  saved: React.ReactNode;
}) {
  const fmt = (n: number) => (unit ? (n / unit.size).toFixed(1) : String(Math.round(n)));
  const toggle = (label: string, on: boolean, flip: () => void, title: string) => (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      className={`tap rounded-control px-2 text-xs ${on ? 'bg-surface font-semibold' : 'text-ink-muted'}`}
      onClick={flip}
    >
      {label}
    </button>
  );
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-2 border-t border-rule bg-raised/90 px-2 text-xs text-ink-muted"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <span className="flex items-center gap-3">
        <span aria-hidden="true" className="tabular-nums">
          {cursor ? `${fmt(cursor[0])}, ${fmt(cursor[1])}${unit ? ` ${unit.unit}` : ''}` : ' '}
        </span>
        <button
          type="button"
          className="tap rounded-control px-1 hover:bg-surface"
          title="Reset zoom to 100%"
          onClick={onZoomReset}
        >
          {Math.round(zoom * 100)}%
        </button>
      </span>
      <span className="flex items-center gap-1">
        {saved}
        {toggle(
          'Snap',
          settings.snap,
          () => {
            onChange({ snap: !settings.snap });
          },
          'Snapping (hold Alt to pause)',
        )}
        {toggle(
          'Grid',
          settings.grid,
          () => {
            onChange({ grid: !settings.grid });
          },
          'Show the grid',
        )}
        {toggle(
          'Rulers',
          settings.rulers,
          () => {
            onChange({ rulers: !settings.rulers });
          },
          'Show rulers and guides',
        )}
      </span>
    </div>
  );
}

/** A small compass: north is up. */
export function Compass() {
  return (
    <svg
      width={34}
      height={34}
      viewBox="-17 -17 34 34"
      role="img"
      aria-label="North is up"
      className="pointer-events-none absolute top-2 right-2 z-10"
    >
      <circle r={15} fill="var(--raised)" fillOpacity={0.85} stroke="var(--rule)" />
      <path d="M0 -12 L4 2 L0 -1 L-4 2 Z" fill="var(--danger)" />
      <path d="M0 12 L4 -2 L0 1 L-4 -2 Z" fill="var(--ink-muted)" opacity={0.6} />
      <text
        y={-5}
        x={0}
        fontSize={7}
        textAnchor="middle"
        fill="var(--paper)"
        fontWeight={700}
        transform="translate(0 -4)"
      >
        N
      </text>
    </svg>
  );
}
