import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Focus rings are never removed. A few controls turn the browser outline off because they show
 * focus another way (a highlighted row); each is listed here with its reason. Anything new fails
 * until it is added with one.
 */
const ALLOWED: Record<string, string> = {
  'app/Shell.tsx': 'main is a programmatic skip-link target, not a control',
  'features/maps/ContextMenu.tsx': 'the focused item is filled (focus:bg-surface)',
  'features/maps/ViewMenu.tsx': 'the highlighted item is filled (data-highlighted)',
  'components/ui/Menu.tsx': 'the highlighted item is filled (data-highlighted)',
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('focus rings', () => {
  it('are only turned off where another focus style is documented', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const offenders = walk(root)
      .filter((f) => /\.(tsx|css)$/.test(f) && !f.endsWith('.test.tsx'))
      .filter((f) => /outline-none|outline:\s*none/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f))
      .filter((f) => !(f in ALLOWED));
    expect(offenders).toEqual([]);
  });
});
