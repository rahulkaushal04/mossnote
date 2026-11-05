// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme } from '../src/theme/applyTheme';
import { dark, light } from '../src/theme/tokens';

function fakeMM(initial: boolean) {
  const handlers = new Set<(e: { matches: boolean }) => void>();
  const q = {
    matches: initial,
    addEventListener: (_: string, h: (e: { matches: boolean }) => void) => void handlers.add(h),
    removeEventListener: (_: string, h: (e: { matches: boolean }) => void) =>
      void handlers.delete(h),
  };
  return {
    mm: () => q as unknown as MediaQueryList,
    handlers,
    set(v: boolean) {
      q.matches = v;
      for (const h of [...handlers]) h({ matches: v });
    },
  };
}

const root = document.documentElement;
const val = (k: string) => root.style.getPropertyValue(k);
afterEach(() => applyTheme('light'));

describe('applyTheme', () => {
  it('explicit modes write variables and data-theme', () => {
    applyTheme('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(val('--bg')).toBe(dark['--bg']);
    applyTheme('light');
    expect(root.dataset.theme).toBe('light');
    expect(val('--bg')).toBe(light['--bg']);
    expect(val('--sp-3')).toBe('12px');
  });

  it('system mode follows live changes', () => {
    const f = fakeMM(false);
    applyTheme('system', root, f.mm);
    expect(root.dataset.theme).toBe('light');
    f.set(true);
    expect(root.dataset.theme).toBe('dark');
    expect(val('--fg')).toBe(dark['--fg']);
    f.set(false);
    expect(root.dataset.theme).toBe('light');
  });

  it('non-system modes ignore OS changes and remove the listener', () => {
    const f = fakeMM(false);
    applyTheme('system', root, f.mm);
    expect(f.handlers.size).toBe(1);
    applyTheme('dark');
    expect(f.handlers.size).toBe(0);
    f.set(false);
    expect(root.dataset.theme).toBe('dark');
  });

  it('switching system -> system does not leak listeners', () => {
    const f = fakeMM(true);
    applyTheme('system', root, f.mm);
    applyTheme('system', root, f.mm);
    expect(f.handlers.size).toBe(1);
    expect(root.dataset.theme).toBe('dark');
  });
});

describe('base.css', () => {
  const css = readFileSync(join(__dirname, '../src/theme/base.css'), 'utf8');
  it('has a visible focus-visible outline using --focus', () => {
    expect(css).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px solid var\(--focus\)/);
  });
  it('never removes outlines', () => {
    expect(css).not.toMatch(/outline:\s*(none|0)/);
  });
  it('disables transitions and animations under reduced motion', () => {
    const m = /@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*)}\s*$/.exec(css);
    expect(m?.[1]).toMatch(/transition:\s*none/);
    expect(m?.[1]).toMatch(/animation:\s*none/);
  });
  it('styles selection and has visually-hidden', () => {
    expect(css).toMatch(/::selection\s*{[^}]*var\(--selection\)/);
    expect(css).toMatch(/\.visually-hidden/);
  });
});
