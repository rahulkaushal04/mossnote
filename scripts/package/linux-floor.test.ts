import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../../src/server/testing/helpers';
import { assertLinuxFloor } from './build-binary';
import { syntheticElf } from './synthetic-elf';

let stage: string;
beforeEach(() => {
  stage = makeTempDir('moss-floor-');
  const prebuilds = path.join(stage, 'node_modules', 'better-sqlite3', 'prebuilds');
  fs.mkdirSync(prebuilds, { recursive: true });
  for (const target of ['linux-x64', 'linux-arm64']) {
    fs.copyFileSync(
      path.resolve('node_modules', 'better-sqlite3', 'prebuilds', `${target}.node`),
      path.join(prebuilds, `${target}.node`),
    );
  }
});
afterEach(() => {
  removeDir(stage);
});

const node = (glibc: string, glibcxx: string) => {
  const file = path.join(stage, 'node');
  fs.writeFileSync(
    file,
    syntheticElf({ 'libc.so.6': [`GLIBC_${glibc}`], 'libstdc++.so.6': [`GLIBCXX_${glibcxx}`] }),
  );
  return file;
};

describe('assertLinuxFloor', () => {
  it('accepts a Node that asks for no more than the SQLite module does, on each architecture', () => {
    expect(() => {
      assertLinuxFloor(stage, node('2.28', '3.4.21'), 'x64');
    }).not.toThrow();
    expect(() => {
      assertLinuxFloor(stage, node('2.28', '3.4.21'), 'arm64');
    }).not.toThrow();
  });

  it('refuses a Node that needs a newer glibc than the documented floor', () => {
    expect(() => {
      assertLinuxFloor(stage, node('2.35', '3.4.21'), 'x64');
    }).toThrow(/needs glibc 2\.35.*documented floor/);
  });

  it('refuses a Node that needs a newer libstdc++ than the documented floor', () => {
    expect(() => {
      assertLinuxFloor(stage, node('2.28', '3.4.30'), 'arm64');
    }).toThrow(/libstdc\+\+ 3\.4\.30/);
  });
});
