/**
 * A colour choice made of named swatches, with an optional none.
 */
import { useState } from 'react';
import { MAP_COLORS } from '@shared/constants';
import { cssColor } from './render/colors';

const KEY = 'moss:map-colors';

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function remember(color: string): string[] {
  const next = [
    color,
    ...loadRecent().filter((c) => c.toLowerCase() !== color.toLowerCase()),
  ].slice(0, 8);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Colours are a convenience; losing them is fine.
  }
  return next;
}

/**
 * Pick a colour: six named ones that follow the theme, a custom colour, and the custom colours
 * used before. `allowNone` adds a "no fill" choice.
 */
export function ColorPicker({
  value,
  onPick,
  label,
  allowNone = false,
}: {
  value: string | null;
  onPick: (c: string | null) => void;
  label: string;
  allowNone?: boolean;
}) {
  const [recent, setRecent] = useState(loadRecent);
  const custom =
    value !== null && !(MAP_COLORS as readonly string[]).includes(value) ? value : null;
  const isCustom = custom !== null;
  const swatch = (c: string, name: string, key = c) => (
    <button
      key={key}
      type="button"
      aria-label={name}
      aria-pressed={value === c}
      title={name}
      onClick={() => {
        onPick(c);
      }}
      className="tap flex size-8 items-center justify-center rounded-full"
    >
      <span
        className={`block size-5 rounded-full border border-rule ${value === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : ''}`}
        style={{ background: cssColor(c) }}
      />
    </button>
  );
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-0.5">
      {allowNone ? (
        <button
          type="button"
          aria-label="No fill"
          aria-pressed={value === null}
          title="No fill"
          onClick={() => {
            onPick(null);
          }}
          className="tap flex size-8 items-center justify-center rounded-full"
        >
          <span
            className={`block size-5 rounded-full border border-ink-muted ${value === null ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : ''}`}
            style={{
              background:
                'linear-gradient(135deg, transparent 45%, var(--danger) 45%, var(--danger) 55%, transparent 55%)',
            }}
          />
        </button>
      ) : null}
      {MAP_COLORS.map((c) => swatch(c, c))}
      {recent.map((c) => swatch(c, `Custom ${c}`))}
      <label
        className="tap flex size-8 cursor-pointer items-center justify-center rounded-full"
        title="Custom colour"
      >
        <span className="sr-only">Custom colour</span>
        <span
          className={`block size-5 rounded-full border border-dashed border-ink-muted ${isCustom ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : ''}`}
          style={{
            background: isCustom
              ? (value ?? undefined)
              : 'conic-gradient(var(--map-rose), var(--map-amber), var(--map-moss), var(--map-sky), var(--map-plum), var(--map-rose))',
          }}
        />
        <input
          type="color"
          className="sr-only"
          value={custom ?? '#4f6f3f'}
          onChange={(e) => {
            const c = e.target.value.toLowerCase();
            setRecent(remember(c));
            onPick(c);
          }}
        />
      </label>
    </div>
  );
}
