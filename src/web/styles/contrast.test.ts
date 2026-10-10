import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@shared/templates';
import { THEME_COLOR } from '../lib/theme';

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

/** Alpha tokens (`--hover`, `--hairline`, `--ring`) are written as `rgb(r g b / a)`. */
function readAlphaTokens(selector: string): Record<string, [string, number]> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens: Record<string, [string, number]> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*rgb\((\d+) (\d+) (\d+) \/ ([0-9.]+)\)\s*;/g)) {
    const hex = [m[2], m[3], m[4]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
    tokens[m[1] ?? ''] = [`#${hex}`, Number(m[5])];
  }
  return tokens;
}

/** The colour an alpha token produces on top of an opaque background. */
function over([fg, alpha]: [string, number], bg: string): string {
  const mix = (shift: number) => {
    const f = (Number.parseInt(fg.slice(1), 16) >> shift) & 255;
    const b = (Number.parseInt(bg.slice(1), 16) >> shift) & 255;
    return Math.round(f * alpha + b * (1 - alpha));
  };
  return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, '0')).join('')}`;
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
    for (const fg of ['ink', 'ink-2', 'ink-muted'] as const) {
      it(`text: ${fg} on a selected card (accent-soft) is at least 4.5:1`, () => {
        const ratio = contrast(tokens[fg] ?? '', tokens['accent-soft'] ?? '');
        expect(ratio, `${fg} on accent-soft = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      });
    }
    it('text on accent fills (accent-ink on accent) is at least 4.5:1', () => {
      expect(contrast(tokens['accent-ink'] ?? '', tokens.accent ?? '')).toBeGreaterThanOrEqual(4.5);
    });
  });
}

const alphaThemes = {
  light: readAlphaTokens(':root'),
  dark: readAlphaTokens(":root[data-theme='dark']"),
};

for (const [name, tokens] of Object.entries(themes)) {
  const alpha = alphaThemes[name as keyof typeof alphaThemes];
  describe(`${name} theme alpha tokens`, () => {
    it('defines hover, hairline and ring', () => {
      for (const token of ['hover', 'hairline', 'ring']) {
        expect(alpha[token], `${name} ${token}`).toBeDefined();
      }
    });
    for (const bg of SURFACES) {
      const base = tokens[bg] ?? '';
      const hover = alpha.hover;
      for (const fg of ['ink', 'ink-2', 'ink-muted', 'accent'] as const) {
        it(`text: ${fg} on a hovered ${bg} is at least 4.5:1`, () => {
          if (!hover) throw new Error('missing --hover');
          const ratio = contrast(tokens[fg] ?? '', over(hover, base));
          expect(ratio, `${fg} on hover/${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        });
      }
      it(`a hairline is visible on ${bg} (decorative, at least 1.15:1)`, () => {
        if (!alpha.hairline) throw new Error('missing --hairline');
        const ratio = contrast(over(alpha.hairline, base), base);
        expect(ratio, `hairline on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(1.15);
      });
      it(`the focus ring is visible on ${bg} (at least 1.2:1)`, () => {
        if (!alpha.ring) throw new Error('missing --ring');
        const ratio = contrast(over(alpha.ring, base), base);
        expect(ratio, `ring on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(1.2);
      });
    }
  });
}

/**
 * Journal tints replace the accent family only. Each one, in each theme, is merged over the base
 * tokens and held to the bars the moss accent meets: accent text on every surface and on a hovered
 * or selected row, ink on a selected card, text on an accent fill, and accent graphics.
 */
const TINTS = {
  moss: { light: "[data-tint='moss']", dark: ":root[data-theme='dark'][data-tint='moss']" },
  plum: { light: "[data-tint='plum']", dark: ":root[data-theme='dark'][data-tint='plum']" },
} as const;

for (const [tint, selectors] of Object.entries(TINTS)) {
  for (const theme of ['light', 'dark'] as const) {
    const base = themes[theme];
    const tokens = { ...base, ...readTokens(selectors[theme]) };
    const alpha = { ...alphaThemes[theme], ...readAlphaTokens(selectors[theme]) };
    describe(`${tint} tint, ${theme} theme`, () => {
      // Moss is the base: restating it is for cards nested in another tint, and must match it.
      it(
        tint === 'moss' ? 'restates the base accent exactly' : 'overrides the accent family',
        () => {
          for (const token of ['accent', 'accent-ink', 'accent-soft'] as const) {
            if (tint === 'moss') expect(tokens[token]).toBe(base[token]);
            else if (token !== 'accent-ink') expect(tokens[token]).not.toBe(base[token]);
          }
          if (tint === 'moss') expect(alpha.ring).toEqual(alphaThemes[theme].ring);
          else expect(alpha.ring).not.toEqual(alphaThemes[theme].ring);
        },
      );
      for (const bg of SURFACES) {
        it(`text: accent on ${bg} is at least 4.5:1`, () => {
          const ratio = contrast(tokens.accent ?? '', tokens[bg] ?? '');
          expect(ratio, `accent on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        });
        it(`graphics: accent on ${bg} is at least 3:1`, () => {
          expect(contrast(tokens.accent ?? '', tokens[bg] ?? '')).toBeGreaterThanOrEqual(3);
        });
        it(`text: accent on a hovered ${bg} is at least 4.5:1`, () => {
          const hover = alpha.hover;
          if (!hover) throw new Error('missing --hover');
          const ratio = contrast(tokens.accent ?? '', over(hover, tokens[bg] ?? ''));
          expect(ratio, `accent on hover/${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        });
        it(`the focus ring is visible on ${bg} (at least 1.2:1)`, () => {
          if (!alpha.ring) throw new Error('missing --ring');
          const ratio = contrast(over(alpha.ring, tokens[bg] ?? ''), tokens[bg] ?? '');
          expect(ratio, `ring on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(1.2);
        });
      }
      it('accent text on a selected (accent-soft) row is at least 4.5:1', () => {
        expect(contrast(tokens.accent ?? '', tokens['accent-soft'] ?? '')).toBeGreaterThanOrEqual(
          4.5,
        );
      });
      for (const fg of ['ink', 'ink-2', 'ink-muted'] as const) {
        it(`text: ${fg} on a selected card (accent-soft) is at least 4.5:1`, () => {
          const ratio = contrast(tokens[fg] ?? '', tokens['accent-soft'] ?? '');
          expect(ratio, `${fg} on accent-soft = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        });
      }
      it('text on accent fills (accent-ink on accent) is at least 4.5:1', () => {
        expect(contrast(tokens['accent-ink'] ?? '', tokens.accent ?? '')).toBeGreaterThanOrEqual(
          4.5,
        );
      });
    });
  }
}

describe('template tints', () => {
  it('every template names a tint whose colours are defined above', () => {
    for (const template of TEMPLATES) {
      expect(template.tint in TINTS, `${template.id} uses the tint "${template.tint}"`).toBe(true);
    }
  });
  it('theme-init.js knows every tint it may be asked to apply', () => {
    const init = fs.readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');
    // Moss is the default the script starts from; every other tint must be named in it.
    for (const tint of Object.keys(TINTS).filter((t) => t !== 'moss')) {
      expect(init).toContain(`'${tint}'`);
    }
  });
});

describe('theme-color meta', () => {
  it('uses the paper colour of each theme', () => {
    expect(THEME_COLOR.light).toBe(themes.light.paper);
    expect(THEME_COLOR.dark).toBe(themes.dark.paper);
  });
});

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
