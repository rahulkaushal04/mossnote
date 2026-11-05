import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function rules(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath: root + filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const RULE = '@typescript-eslint/no-restricted-imports';

// The renderer must reach core only through RPC; this proves the rule fires, so the boundary is not just a promise.
describe('renderer import boundary', () => {
  it('rejects value imports from core', async () => {
    expect(
      await rules(
        "import { openWorkspace } from '@mossnote/core';\nexport const f = openWorkspace;\n",
        'packages/ui/src/a.ts',
      ),
    ).toContain(RULE);
  });

  it('rejects value imports from a core subpath', async () => {
    expect(
      await rules(
        "import { methods } from '@mossnote/core/rpc';\nexport const m = methods;\n",
        'packages/ui/src/b.ts',
      ),
    ).toContain(RULE);
  });

  it('rejects electron, node: and better-sqlite3 in the renderer', async () => {
    expect(await rules("import 'electron';\n", 'packages/ui/src/c.ts')).toContain(RULE);
    expect(
      await rules(
        "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n",
        'packages/ui/src/d.ts',
      ),
    ).toContain(RULE);
    expect(
      await rules(
        "import Database from 'better-sqlite3';\nexport const D = Database;\n",
        'packages/ui/src/e.ts',
      ),
    ).toContain(RULE);
  });

  it('allows type-only imports from core', async () => {
    expect(
      await rules(
        "import type { Result } from '@mossnote/core';\nexport type R = Result<number>;\n",
        'packages/ui/src/f.ts',
      ),
    ).not.toContain(RULE);
    expect(
      await rules(
        "import type { Methods } from '@mossnote/core/rpc';\nexport type M = Methods;\n",
        'packages/ui/src/g.ts',
      ),
    ).not.toContain(RULE);
  });

  it('does not restrict test files', async () => {
    expect(
      await rules(
        "import { openWorkspace } from '@mossnote/core';\nexport const f = openWorkspace;\n",
        'packages/ui/test/h.ts',
      ),
    ).not.toContain(RULE);
  });
});
