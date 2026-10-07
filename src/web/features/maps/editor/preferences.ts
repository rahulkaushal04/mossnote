/** Editor preferences kept in `localStorage`: snapping, grid and the default drawing style. */
import { useCallback, useState } from 'react';
import {
  DEFAULT_DRAW,
  DEFAULT_SETTINGS,
  type DrawStyle,
  type EditorSettings,
} from '../editorTypes';

const SETTINGS_KEY = 'moss:map-settings';
const DRAW_KEY = 'moss:map-draw';

/** Read stored preferences over `fallback`. Unreadable or missing storage gives the fallback. */
function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object'
      ? { ...fallback, ...(parsed as Partial<T>) }
      : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences are a convenience.
  }
}

/** A preference object with a patch-style setter that saves every change. */
function usePersistedObject<T extends object>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => load(key, fallback));
  const patch = useCallback(
    (change: Partial<T>) => {
      setValue((current) => {
        const next = { ...current, ...change };
        save(key, next);
        return next;
      });
    },
    [key],
  );
  return [value, patch] as const;
}

export function useEditorPreferences() {
  const [settings, setSettings] = usePersistedObject<EditorSettings>(
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
  );
  const [draw, setDraw] = usePersistedObject<DrawStyle>(DRAW_KEY, DEFAULT_DRAW);
  return { settings, setSettings, draw, setDraw };
}
