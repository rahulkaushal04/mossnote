import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from './testing/helpers';
import { readAppVersion } from './version';

let dir: string;
beforeEach(() => {
  dir = makeTempDir('moss-version-');
});
afterEach(() => {
  removeDir(dir);
});

const write = (name: string, text: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return pathToFileURL(file);
};

describe('readAppVersion', () => {
  it('reads the version from a package.json', () => {
    expect(readAppVersion(write('package.json', '{"name":"x","version":"1.2.3-beta.4"}'))).toBe(
      '1.2.3-beta.4',
    );
  });

  it('says unknown, and does not throw, when there is no usable version', () => {
    expect(readAppVersion(pathToFileURL(path.join(dir, 'missing.json')))).toBe('unknown');
    expect(readAppVersion(write('bad.json', 'not json'))).toBe('unknown');
    expect(readAppVersion(write('none.json', '{"name":"x"}'))).toBe('unknown');
    expect(readAppVersion(write('empty.json', '{"version":""}'))).toBe('unknown');
    expect(readAppVersion(write('number.json', '{"version":3}'))).toBe('unknown');
  });

  it("matches the repository's own package.json, which is what the entry point reads", () => {
    const own = readAppVersion(new URL('../../package.json', import.meta.url));
    expect(own).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });
});
