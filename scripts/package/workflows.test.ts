import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nothing may reach a package registry from a tag that fails the release checks. npm waits for
 * them in `release.yml`; PyPI publishes from `pypi.yml` (its trusted publisher is registered for
 * that file name), so it has to wait for the same checks by calling the workflow that holds them.
 */
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file: string) =>
  fs.readFileSync(path.join(root, '.github', 'workflows', file), 'utf8');

/** The text of one job: from its name at two spaces of indentation to the next job's. */
function job(workflow: string, name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:\\n`, 'm'));
  if (start === -1) throw new Error(`No job called ${name}.`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(rest.indexOf('\n') + 1).search(/^ {2}[a-z][a-z-]*:\n/m);
  return next === -1 ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next);
}

const VERIFY = './.github/workflows/verify.yml';

describe('the release checks', () => {
  it('live in one workflow that other workflows can call', () => {
    const verify = read('verify.yml');
    expect(verify).toMatch(/^on:\n {2}workflow_call:/m);
    for (const step of [
      'npm run lint',
      'npm run format:check',
      'npm run typecheck',
      'npm test',
      'npm run test:wasm',
      'npm run build',
      'npm run build:standalone',
      'npm run check:network',
      'npm run package:npm-smoke',
    ]) {
      expect(verify, step).toContain(`run: ${step}\n`);
    }
  });

  it('are what release.yml runs before it builds, drafts or publishes anything', () => {
    const release = read('release.yml');
    expect(job(release, 'verify')).toContain(`uses: ${VERIFY}`);
    expect(job(release, 'binaries')).toMatch(/needs: verify\b/);
    expect(job(release, 'draft')).toMatch(/needs: \[verify, binaries\]/);
    expect(job(release, 'npm')).toMatch(/needs: draft\b/);
  });

  it('are what pypi.yml waits for before it publishes to PyPI', () => {
    const pypi = read('pypi.yml');
    const check = job(pypi, 'verify');
    expect(check).toContain(`uses: ${VERIFY}`);
    const publish = job(pypi, 'publish-pypi');
    expect(publish).toMatch(/needs: \[build, test, verify\]/);
    // The check runs exactly when a PyPI upload could happen, and for no other run of the workflow.
    const condition = (text: string) => /^ {4}if: (.+)$/m.exec(text)?.[1];
    expect(condition(check)).toBe(condition(publish));
  });

  it('leave the practice upload to TestPyPI quick: it does not wait for them', () => {
    expect(job(read('pypi.yml'), 'publish-testpypi')).not.toContain('verify');
  });
});
