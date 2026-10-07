/**
 * Saved drawing styles: apply one, or save the current style.
 */
import { useState } from 'react';
import type { MapStyle } from '@shared/schemas/map';
import { cssColor } from './render/colors';

const KEY = 'moss:map-styles';
const MAX = 12;

export interface StylePreset {
  name: string;
  style: MapStyle;
}

function load(): StylePreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is StylePreset =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as StylePreset).name === 'string' &&
          typeof (p as StylePreset).style === 'object',
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

function store(list: StylePreset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Saved styles are a convenience; losing them is fine.
  }
}

/**
 * Styles you name once and reuse: a road, a trail, a wall. They live in this browser, are never
 * made for you, and apply to the selection (or to what you draw next when nothing is selected).
 */
export function StylePresets({
  current,
  onApply,
}: {
  current: MapStyle;
  onApply: (s: MapStyle) => void;
}) {
  const [list, setList] = useState(load);
  const [name, setName] = useState('');
  const save = () => {
    const n = name.trim().slice(0, 24);
    if (n === '') return;
    const next = [
      { name: n, style: current },
      ...list.filter((p) => p.name.toLowerCase() !== n.toLowerCase()),
    ].slice(0, MAX);
    setList(next);
    store(next);
    setName('');
  };
  const remove = (n: string) => {
    const next = list.filter((p) => p.name !== n);
    setList(next);
    store(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Name for this style</span>
          <input
            value={name}
            maxLength={24}
            placeholder="Save this style as…"
            onChange={(e) => {
              setName(e.target.value);
            }}
            className="tap w-full rounded-control border border-ink-muted bg-paper px-2 text-sm"
          />
        </label>
        <button type="submit" className="btn tap px-2 text-sm" disabled={name.trim() === ''}>
          Save
        </button>
      </form>
      {list.length > 0 ? (
        <ul aria-label="Saved styles" className="m-0 flex list-none flex-col gap-1 p-0">
          {list.map((p) => (
            <li key={p.name} className="flex items-center gap-1">
              <button
                type="button"
                className="btn tap flex-1 justify-start gap-2 px-2 text-sm"
                onClick={() => {
                  onApply(p.style);
                }}
              >
                <svg width={34} height={12} viewBox="0 0 34 12" aria-hidden="true">
                  <line
                    x1={2}
                    y1={6}
                    x2={32}
                    y2={6}
                    stroke={cssColor(p.style.stroke)}
                    strokeWidth={Math.min(p.style.width, 8)}
                    strokeLinecap="round"
                    strokeDasharray={
                      p.style.dash === 'dashed'
                        ? '6 4'
                        : p.style.dash === 'dotted'
                          ? '0.1 5'
                          : undefined
                    }
                  />
                </svg>
                {p.name}
              </button>
              <button
                type="button"
                className="tap rounded-control px-2 text-sm text-danger"
                aria-label={`Delete style ${p.name}`}
                onClick={() => {
                  remove(p.name);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
