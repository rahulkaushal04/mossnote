export type Platform = 'mac' | 'other';

export const detectPlatform = (): Platform =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'other';

const ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const ALIAS: Record<string, string> = {
  cmd: 'Meta',
  command: 'Meta',
  control: 'Ctrl',
  c: 'Ctrl',
  s: 'Shift',
  a: 'Alt',
  m: 'Meta',
};

/** "Shift-Mod-K" to a canonical "Ctrl-Shift-k" for the platform (Mod is Meta on mac, Ctrl elsewhere). */
export function normalizeKey(shortcut: string, platform: Platform): string {
  const parts = shortcut.split(/-(?=.)/);
  const key = parts.pop()!;
  const mods = new Set<string>();
  for (const p of parts) {
    const l = p.toLowerCase();
    mods.add(
      l === 'mod'
        ? platform === 'mac'
          ? 'Meta'
          : 'Ctrl'
        : (ALIAS[l] ?? p[0]!.toUpperCase() + p.slice(1)),
    );
  }
  return [...ORDER.filter((m) => mods.has(m)), key.length === 1 ? key.toLowerCase() : key].join(
    '-',
  );
}

const CODES: Record<string, string> = {
  '\\': 'Backslash',
  '/': 'Slash',
  ',': 'Comma',
  '.': 'Period',
};

/** Does the keydown event match the manifest shortcut? Falls back to `code` when Shift/Alt change `key`. */
export function matchesEvent(e: KeyboardEvent, shortcut: string, platform: Platform): boolean {
  // AltGr (Ctrl+Alt on Windows/Linux layouts) types characters; never treat it as a shortcut.
  if (e.getModifierState?.('AltGraph')) return false;
  const norm = normalizeKey(shortcut, platform).split('-');
  const key = norm.pop()!;
  const want = new Set(norm);
  const have = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'];
  if (ORDER.some((m, i) => want.has(m) !== !!have[i])) return false;
  if (e.key.toLowerCase() === key.toLowerCase()) return true;
  if (key.length !== 1) return false;
  return e.code === (CODES[key] ?? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`));
}

/** Human text: "⇧⌘L" on macOS, "Ctrl+Shift+L" elsewhere. */
export function formatShortcut(shortcut: string, platform: Platform): string {
  const parts = normalizeKey(shortcut, platform).split('-');
  const key = parts.pop()!;
  const k = key.length === 1 ? key.toUpperCase() : key;
  if (platform !== 'mac') return [...parts, k].join('+');
  const sym: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
  return parts.map((p) => sym[p]).join('') + (k === 'Backspace' ? '⌫' : k);
}
