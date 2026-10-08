import { useSyncExternalStore } from 'react';
import { readStorage, writeStorage } from './storage';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ReadingSize = 'comfortable' | 'large';

const THEME_KEY = 'moss:theme';
const UI_KEY = 'moss:ui';

const listeners = new Set<() => void>();
const notify = () => {
  listeners.forEach((l) => {
    l();
  });
};

function readTheme(): ThemeChoice {
  const raw = readStorage(THEME_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The page colour per theme, for the browser's address bar. Must equal `--paper` in tokens.css (a test checks). */
export const THEME_COLOR = { light: '#f7f5f0', dark: '#141816' } as const;

function setThemeColor(dark: boolean): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = dark ? THEME_COLOR.dark : THEME_COLOR.light;
}

/** Apply the choice to the document (the blocking theme-init.js does the same before first paint). */
export function applyTheme(choice: ThemeChoice = readTheme()): void {
  const dark = choice === 'dark' || (choice === 'system' && systemPrefersDark());
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  setThemeColor(dark);
}

export function setTheme(choice: ThemeChoice): void {
  writeStorage(THEME_KEY, choice);
  applyTheme(choice);
  notify();
}

interface UiPrefs {
  readingSize?: ReadingSize;
  /** False turns off single-key shortcuts (WCAG 2.1.4). Modifier shortcuts stay on. */
  singleKeys?: boolean;
}

function readUi(): UiPrefs {
  try {
    const parsed: unknown = JSON.parse(readStorage(UI_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export const singleKeysEnabled = (): boolean => readUi().singleKeys !== false;

export function setSingleKeysEnabled(enabled: boolean): void {
  writeStorage(UI_KEY, JSON.stringify({ ...readUi(), singleKeys: enabled }));
  notify();
}

export const useSingleKeys = (): boolean =>
  useSyncExternalStore(subscribe, singleKeysEnabled, () => true);

export function applyReadingSize(size: ReadingSize): void {
  document.documentElement.setAttribute('data-reading', size);
}

/** Cache the reading size locally so the next page load applies it before first paint. */
export function setReadingSize(size: ReadingSize): void {
  writeStorage(UI_KEY, JSON.stringify({ ...readUi(), readingSize: size }));
  applyReadingSize(size);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Follow the operating system while the choice is System. Returns a cleanup function. */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const query = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (readTheme() === 'system') applyTheme('system');
  };
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

export const useThemeChoice = (): ThemeChoice =>
  useSyncExternalStore(subscribe, readTheme, () => 'system');

export const useCachedReadingSize = (): ReadingSize =>
  useSyncExternalStore(
    subscribe,
    () => (readUi().readingSize === 'large' ? 'large' : 'comfortable'),
    () => 'comfortable',
  );
