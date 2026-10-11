import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { atMost, compareVersions, highest, isElf, versionNeeds, versionOf } from './elf';
import { LINUX_FLOOR } from './linux-floor';
import { syntheticElf } from './synthetic-elf';

const elf = syntheticElf({
  'libstdc++.so.6': ['GLIBCXX_3.4.29', 'GLIBCXX_3.4.21'],
  'libc.so.6': ['GLIBC_2.34'],
});

describe('versionNeeds', () => {
  it('reads each library and the versions of it that a file needs', () => {
    expect(versionNeeds(elf)).toEqual({
      'libstdc++.so.6': ['GLIBCXX_3.4.29', 'GLIBCXX_3.4.21'],
      'libc.so.6': ['GLIBC_2.34'],
    });
  });

  it('finds the newest version of each family', () => {
    const needs = versionNeeds(elf);
    expect(highest(needs, 'GLIBC')).toBe('2.34');
    expect(highest(needs, 'GLIBCXX')).toBe('3.4.29');
    expect(highest(needs, 'CXXABI')).toBeNull();
  });

  it('refuses a file that is not a 64-bit little-endian ELF', () => {
    expect(isElf(Buffer.from('#!/bin/sh\n'.padEnd(100)))).toBe(false);
    expect(() => versionNeeds(Buffer.alloc(100))).toThrow('Not a 64-bit little-endian ELF');
  });
});

describe('version helpers', () => {
  it('compare numbers, not text', () => {
    expect(compareVersions([2, 9], [2, 34])).toBeLessThan(0);
    expect(compareVersions([3, 4, 29], [3, 4, 9])).toBeGreaterThan(0);
    expect(compareVersions([2, 34], [2, 34, 0])).toBe(0);
    expect(versionOf('GLIBC_2.34', 'GLIBC')).toEqual([2, 34]);
    expect(versionOf('GLIBCXX_3.4', 'GLIBC')).toBeNull();
    expect(atMost('2.28', '2.34')).toBe(true);
    expect(atMost('2.35', '2.34')).toBe(false);
    expect(atMost(null, '2.34')).toBe(true);
  });
});

describe('the SQLite module that ships in the standalone program', () => {
  const prebuilds = path.resolve('node_modules', 'better-sqlite3', 'prebuilds');

  it.each(['linux-x64', 'linux-arm64'])(
    'needs no newer glibc or libstdc++ than the documented floor (%s)',
    (target) => {
      const needs = versionNeeds(fs.readFileSync(path.join(prebuilds, `${target}.node`)));
      expect(highest(needs, 'GLIBC'), 'glibc').toBe(LINUX_FLOOR.glibc);
      expect(highest(needs, 'GLIBCXX'), 'libstdc++').toBe(LINUX_FLOOR.glibcxx);
    },
  );

  it('has a build for musl (Alpine), which the standalone program does not use', () => {
    const needs = versionNeeds(fs.readFileSync(path.join(prebuilds, 'linuxmusl-x64.node')));
    expect(highest(needs, 'GLIBC')).toBeNull();
  });
});
