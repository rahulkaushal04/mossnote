import { describe, expect, it } from 'vitest';
import { PAIRS, contrast, minRatio, themes, type Pair } from '../src/theme/tokens';

function failures(pairs: Pair[]): string[] {
  const out: string[] = [];
  for (const [name, map] of Object.entries(themes)) {
    for (const p of pairs) {
      const fg = map[p.fg];
      const bg = map[p.bg];
      if (!fg || !bg) out.push(`${name} ${p.fg}/${p.bg} missing`);
      else if (contrast(fg, bg) < minRatio(p.kind)) out.push(`${name} ${p.fg}/${p.bg}`);
    }
  }
  return out;
}

describe('contrast function', () => {
  it('black/white is 21:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
  it('#767676 on white is the known ~4.54 boundary', () => {
    const r = contrast('#767676', '#ffffff');
    expect(r).toBeGreaterThanOrEqual(4.5);
    expect(r).toBeLessThan(4.6);
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});

describe('token pairs', () => {
  it('every PAIRS entry passes in both themes', () => {
    expect(failures(PAIRS)).toEqual([]);
  });
  it('covers each theme color token used as a foreground', () => {
    const keys = new Set(PAIRS.map((p) => p.fg));
    for (const k of [
      '--fg',
      '--fg-muted',
      '--placeholder',
      '--link',
      '--accent-fg',
      '--danger-fg',
      '--border',
      '--focus',
      '--syn-keyword',
      '--syn-link',
    ])
      expect(keys.has(k)).toBe(true);
  });
  it('covers the backgrounds that occur: selected rows/text and code spans', () => {
    const has = (fg: string, bg: string) => PAIRS.some((p) => p.fg === fg && p.bg === bg);
    for (const [fg, bg] of [
      ['--fg-muted', '--selection'],
      ['--fg-muted', '--code-bg'],
      ['--fg', '--selection'],
      ['--fg', '--code-bg'],
      ['--link', '--selection'],
      ['--syn-comment', '--selection'],
      ['--syn-keyword', '--selection'],
    ] as const)
      expect(has(fg, bg), `${fg} on ${bg}`).toBe(true);
  });
  it('mutation: a low-contrast pair is detected', () => {
    const bad: Pair[] = [...PAIRS, { fg: '--bg-sunken', bg: '--bg', kind: 'text' }];
    expect(failures(bad).length).toBeGreaterThan(0);
  });
});
