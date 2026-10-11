import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_NODE, nodeIsSupported } from '../../bin/options.js';

/**
 * The oldest Node and the version number are each written in several places. These tests fail when
 * one of them is changed and another is forgotten, which is how a package ends up promising
 * something its own start-up check refuses.
 */
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json')) as { version: string; engines: { node: string } };
const minimum = `${MIN_NODE.major}.${MIN_NODE.minor}`;

function files(dir: string, keep: (name: string) => boolean): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return files(relative, keep);
    return keep(entry.name) ? [relative] : [];
  });
}

describe('the oldest supported Node', () => {
  it('is the same in package.json, the start-up check, the program builder and .nvmrc', () => {
    expect(pkg.engines.node).toBe(`>=${minimum}.0`);
    expect(read('scripts/package/build-binary.ts')).toContain(`minor < ${MIN_NODE.minor}`);
    expect(read('scripts/package/build-binary.ts')).toContain(`Node ${minimum} or newer`);
    expect(nodeIsSupported(read('.nvmrc').trim().replace(/^v/, ''))).toBe(true);
  });

  it('is what the documentation says, and none of it still says the old number', () => {
    const documents = [
      'README.md',
      'CONTRIBUTING.md',
      'docs/content/getting-started.html',
      'docs/content/reference.html',
      'docs/content/how-it-works.html',
    ];
    for (const document of documents) {
      expect(read(document), document).toContain(minimum);
      expect(read(document), document).not.toMatch(/22\.12/);
    }
  });

  it('is tested by CI, which also tests the newest Node lines', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain(`node: [${minimum}.0, 22, 24, 26]`);
    expect(ci).toContain('node: [22, 24, 26]');
  });
});

describe('the version number', () => {
  it('is a semantic version, and the lockfile agrees with package.json', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    const lock = JSON.parse(read('package-lock.json')) as {
      version: string;
      packages: Record<string, { version: string; engines?: { node: string } }>;
    };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);
    expect(lock.packages['']?.engines).toEqual(pkg.engines);
  });

  it('is never written out in the documentation or the code, so it cannot go stale', () => {
    // The stable "0.1.0" in particular must not appear while the project is in beta: it would
    // read as a claim that a stable release exists. "0.1.0-test" in test fixtures is fine.
    const candidates = [
      'README.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'bin/mossnote.js',
      'bin/options.js',
      ...files('docs/content', (name) => name.endsWith('.html')),
      ...files('src', (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)),
      ...files('scripts', (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')),
    ];
    const stable = /(?<![\d.])0\.1\.0(?![\d.-])/;
    const offenders = candidates.filter((file) => stable.test(read(file)));
    expect(offenders).toEqual([]);
  });
});
