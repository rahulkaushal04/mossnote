import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function lint(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath: root + filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

// CS-11: the lint rule must actually fire, otherwise the boundary is only a promise.
describe('core import boundary (CS-11)', () => {
  it('rejects Electron imports in core', async () => {
    expect(
      await lint(
        "import { app } from 'electron';\nexport const a = app;\n",
        'packages/core/src/x.ts',
      ),
    ).toContain('no-restricted-imports');
  });

  it('rejects React imports in core', async () => {
    expect(
      await lint("import React from 'react';\nexport const r = React;\n", 'packages/core/src/y.ts'),
    ).toContain('no-restricted-imports');
  });

  it('allows the same import outside core', async () => {
    expect(
      await lint(
        "import { app } from 'electron';\nexport const a = app;\n",
        'packages/desktop/src/z.ts',
      ),
    ).not.toContain('no-restricted-imports');
  });
});
