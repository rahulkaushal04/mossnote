import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dark, light, shared } from '../src/theme/tokens';

const SRC = join(__dirname, '../src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(SRC);
const css = files.filter((f) => f.endsWith('.css'));
const defined = new Set([...Object.keys(light), ...Object.keys(shared)]);

describe('css variables', () => {
  it('light and dark define the same color tokens', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });
  it('every var(--x) in ui css and ts sources exists in tokens', () => {
    const missing: string[] = [];
    for (const f of files.filter((x) => /\.(css|ts|tsx)$/.test(x) && !x.endsWith('tokens.ts'))) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*(,|\))/g)) {
        // a var() with a fallback is still reported: tokens must exist
        if (!defined.has(m[1]!)) missing.push(`${f.slice(SRC.length)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('scans base.css at least', () => {
    expect(css.some((f) => f.endsWith('theme/base.css'))).toBe(true);
  });
  it('no remote URLs, url(), or @font-face in ui css', () => {
    for (const f of css) {
      const t = readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/https?:\/\//i);
      expect(t, f).not.toMatch(/url\(/i);
      expect(t, f).not.toMatch(/@font-face/i);
    }
  });
});
