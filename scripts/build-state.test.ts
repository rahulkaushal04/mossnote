import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../src/server/testing/helpers';
import { BUILD_MODE_FILE, needsBuild } from './build-state';

let root: string;
// directories carry the time they were made, so the build is dated ahead of it
const BUILT = Date.now() + 60_000;

const write = (file: string, at: number, text = 'x') => {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  fs.utimesSync(full, at / 1000, at / 1000);
};

beforeEach(() => {
  root = makeTempDir('moss-build-');
  write('src/a.ts', BUILT - 10_000);
  write('dist/server/index.js', BUILT);
  write('dist/web/index.html', BUILT);
  write(BUILD_MODE_FILE, BUILT, 'production');
});

afterEach(() => {
  removeDir(root);
});

describe('needsBuild', () => {
  it('is false for a production build newer than the sources', () => {
    expect(needsBuild(root)).toBe(false);
  });

  it('is true when a source file is newer than the build', () => {
    write('src/a.ts', BUILT + 10_000);

    expect(needsBuild(root)).toBe(true);
  });

  it('is true when the build is for the browser tests, which adds a route a real build lacks', () => {
    write(BUILD_MODE_FILE, BUILT, 'e2e');

    expect(needsBuild(root)).toBe(true);
  });

  it('is true when the build does not say what it is', () => {
    fs.rmSync(path.join(root, BUILD_MODE_FILE));

    expect(needsBuild(root)).toBe(true);
  });

  it('is true when there is no build', () => {
    fs.rmSync(path.join(root, 'dist'), { recursive: true });

    expect(needsBuild(root)).toBe(true);
  });
});
