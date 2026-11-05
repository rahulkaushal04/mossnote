// Single source of design tokens. Colors differ per theme; the rest is shared.
export type ThemeName = 'light' | 'dark';
export type TokenMap = Record<string, string>;

export const light: TokenMap = {
  '--bg': '#faf9f6',
  '--bg-elev': '#ffffff',
  '--bg-sunken': '#f0eee8',
  '--fg': '#1c1d1a',
  '--fg-muted': '#585b53',
  '--placeholder': '#656860',
  '--border': '#898c82',
  '--accent': '#3b6747',
  '--accent-fg': '#ffffff',
  '--focus': '#2b6a49',
  '--danger': '#b3261e',
  '--danger-fg': '#ffffff',
  '--selection': '#d3e6d8',
  '--code-bg': '#efede6',
  '--link': '#245f86',
  '--syn-keyword': '#7a3a9a',
  '--syn-string': '#1f6a39',
  '--syn-comment': '#5b5f55',
  '--syn-number': '#9c4710',
  '--syn-heading': '#2b5a38',
  '--syn-link': '#1f5a84',
};

export const dark: TokenMap = {
  '--bg': '#151714',
  '--bg-elev': '#1d201c',
  '--bg-sunken': '#0f110e',
  '--fg': '#e8e8e1',
  '--fg-muted': '#a4a89b',
  '--placeholder': '#979c8f',
  '--border': '#6d7268',
  '--accent': '#8fbf9a',
  '--accent-fg': '#0f1a12',
  '--focus': '#8fbf9a',
  '--danger': '#e5786f',
  '--danger-fg': '#1a0b0a',
  '--selection': '#243a2b',
  '--code-bg': '#1f221d',
  '--link': '#8cc0e6',
  '--syn-keyword': '#c9a0e6',
  '--syn-string': '#9fd3a8',
  '--syn-comment': '#9a9f92',
  '--syn-number': '#e0a470',
  '--syn-heading': '#b5dcbc',
  '--syn-link': '#8cc0e6',
};

/** Theme-independent tokens (spacing, type, radius, motion). */
export const shared: TokenMap = {
  '--sp-1': '4px',
  '--sp-2': '8px',
  '--sp-3': '12px',
  '--sp-4': '16px',
  '--sp-5': '24px',
  '--sp-6': '32px',
  '--font-ui': 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  '--font-mono': 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  '--fs-sm': '12px',
  '--fs-base': '14px',
  '--fs-md': '16px',
  '--fs-lg': '20px',
  '--fs-xl': '24px',
  '--lh-body': '1.6',
  '--radius': '6px',
  '--dur': '120ms',
  '--ease': 'cubic-bezier(0.2, 0, 0, 1)',
};

export const themes: Record<ThemeName, TokenMap> = { light, dark };

export type Pair = { fg: string; bg: string; kind: 'text' | 'ui' };

const SYN = ['keyword', 'string', 'comment', 'number', 'heading', 'link'];

export const PAIRS: Pair[] = [
  { fg: '--fg', bg: '--bg', kind: 'text' },
  { fg: '--fg', bg: '--bg-elev', kind: 'text' },
  { fg: '--fg', bg: '--bg-sunken', kind: 'text' },
  { fg: '--fg', bg: '--code-bg', kind: 'text' },
  { fg: '--fg', bg: '--selection', kind: 'text' },
  { fg: '--fg-muted', bg: '--bg', kind: 'text' },
  { fg: '--fg-muted', bg: '--bg-elev', kind: 'text' },
  { fg: '--fg-muted', bg: '--bg-sunken', kind: 'text' },
  // Selected rows (list, tree) and the editor selection; code spans/fences; muted punctuation sits on both.
  // (The row divider --border on a selected row is decorative, so it is not a 3:1 pair.)
  { fg: '--fg-muted', bg: '--selection', kind: 'text' },
  { fg: '--fg-muted', bg: '--code-bg', kind: 'text' },
  { fg: '--link', bg: '--selection', kind: 'text' },
  { fg: '--accent', bg: '--selection', kind: 'ui' },
  { fg: '--focus', bg: '--selection', kind: 'ui' },
  { fg: '--placeholder', bg: '--bg', kind: 'text' },
  { fg: '--placeholder', bg: '--bg-elev', kind: 'text' },
  { fg: '--accent-fg', bg: '--accent', kind: 'text' },
  { fg: '--danger-fg', bg: '--danger', kind: 'text' },
  { fg: '--link', bg: '--bg', kind: 'text' },
  { fg: '--link', bg: '--bg-elev', kind: 'text' },
  // [role=alert] text sits on the page, on banners and in dialogs/toasts.
  { fg: '--danger', bg: '--bg', kind: 'text' },
  { fg: '--danger', bg: '--bg-elev', kind: 'text' },
  { fg: '--border', bg: '--bg', kind: 'ui' },
  { fg: '--border', bg: '--bg-elev', kind: 'ui' },
  { fg: '--focus', bg: '--bg', kind: 'ui' },
  { fg: '--focus', bg: '--bg-elev', kind: 'ui' },
  ...SYN.flatMap((s): Pair[] => [
    { fg: `--syn-${s}`, bg: '--bg', kind: 'text' },
    { fg: `--syn-${s}`, bg: '--code-bg', kind: 'text' },
    { fg: `--syn-${s}`, bg: '--selection', kind: 'text' },
  ]),
];

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`bad color ${hex}`);
  const n = parseInt(m[1]!, 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function minRatio(kind: Pair['kind']): number {
  return kind === 'text' ? 4.5 : 3;
}
