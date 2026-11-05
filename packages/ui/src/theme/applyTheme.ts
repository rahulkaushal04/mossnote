import { shared, themes, type ThemeName } from './tokens';

export type ThemeMode = ThemeName | 'system';

const QUERY = '(prefers-color-scheme: dark)';

type MQ = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
type MatchMedia = (q: string) => MQ;

function write(name: ThemeName, root: HTMLElement): void {
  for (const [k, v] of Object.entries({ ...shared, ...themes[name] })) root.style.setProperty(k, v);
  root.dataset.theme = name;
  root.style.colorScheme = name;
}

/**
 * Calls onChange(dark) now and on every OS change; returns an unsubscribe.
 * `mm` is injectable for tests.
 */
export function watchSystemTheme(
  onChange: (dark: boolean) => void,
  mm: MatchMedia | undefined = globalThis.matchMedia?.bind(globalThis),
): () => void {
  if (!mm) {
    onChange(false);
    return () => undefined;
  }
  const q = mm(QUERY);
  const handler = (e: { matches: boolean }): void => onChange(e.matches);
  q.addEventListener('change', handler);
  onChange(q.matches);
  return () => q.removeEventListener('change', handler);
}

let stop: (() => void) | null = null;

/** Applies the theme; in system mode keeps following the OS until the next call. Returns the unsubscribe. */
export function applyTheme(
  mode: ThemeMode,
  root: HTMLElement = document.documentElement,
  mm?: MatchMedia,
): () => void {
  stop?.();
  stop = null;
  if (mode !== 'system') {
    write(mode, root);
    return () => undefined;
  }
  const off = watchSystemTheme((dark) => write(dark ? 'dark' : 'light', root), mm);
  stop = off;
  return () => {
    off();
    if (stop === off) stop = null;
  };
}
