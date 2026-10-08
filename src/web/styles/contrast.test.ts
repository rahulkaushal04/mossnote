import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Contrast check for the design tokens: text at least 4.5:1, interface
 * components and graphics at least 3:1, in both themes. The tokens are read from tokens.css, so
 * this test checks the values that actually ship.
 */
const css = fs.readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function readTokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1] ?? ''] = (match[2] ?? '').toLowerCase();
  }
  return tokens;
}

const themes = {
  light: readTokens(':root'),
  dark: readTokens(":root[data-theme='dark']"),
};

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SURFACES = ['paper', 'surface', 'raised'] as const;
// Everything that renders as text, including the ✦ and ? marks' labels, links and errors.
const TEXT = [
  'ink',
  'ink-2',
  'ink-muted',
  'accent',
  'discovery',
  'question',
  'danger',
  'success',
] as const;
// Marks, focus ring and control outlines (WCAG 1.4.11).
const GRAPHICS = ['accent', 'discovery', 'question', 'danger', 'control'] as const;
// Body text and headings are held to the stricter AAA bar.
const BODY = ['ink'] as const;

describe('tokens are present in both themes', () => {
  for (const [name, tokens] of Object.entries(themes)) {
    it(`${name} defines every semantic token`, () => {
      for (const token of [
        'paper',
        'surface',
        'raised',
        'ink',
        'ink-2',
        'ink-muted',
        'line',
        'control',
        'accent',
        'accent-ink',
        'accent-soft',
        'success',
        'discovery',
        'question',
        'danger',
      ]) {
        expect(tokens[token], `${name} ${token}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  }
});

for (const [name, tokens] of Object.entries(themes)) {
  describe(`${name} theme contrast`, () => {
    for (const fg of TEXT) {
      for (const bg of SURFACES) {
        it(`text: ${fg} on ${bg} is at least 4.5:1`, () => {
          const ratio = contrast(tokens[fg] ?? '', tokens[bg] ?? '');
          expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    for (const fg of GRAPHICS) {
      for (const bg of SURFACES) {
        it(`graphics: ${fg} on ${bg} is at least 3:1`, () => {
          const ratio = contrast(tokens[fg] ?? '', tokens[bg] ?? '');
          expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
        });
      }
    }
    for (const fg of BODY) {
      for (const bg of SURFACES) {
        it(`body text: ${fg} on ${bg} is at least 7:1`, () => {
          const ratio = contrast(tokens[fg] ?? '', tokens[bg] ?? '');
          expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(7);
        });
      }
    }
    it('accent text on a selected (accent-soft) row is at least 4.5:1', () => {
      expect(contrast(tokens.accent ?? '', tokens['accent-soft'] ?? '')).toBeGreaterThanOrEqual(
        4.5,
      );
    });
    it('text on accent fills (accent-ink on accent) is at least 4.5:1', () => {
      expect(contrast(tokens['accent-ink'] ?? '', tokens.accent ?? '')).toBeGreaterThanOrEqual(4.5);
    });
  });
}

describe('the checker itself', () => {
  it('computes the WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('would flag a failing pair', () => {
    expect(contrast('#aaaaaa', '#ffffff')).toBeLessThan(4.5);
  });
});
