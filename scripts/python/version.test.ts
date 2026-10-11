import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toPep440 } from './version';

const root = path.resolve(import.meta.dirname, '..', '..');

describe('toPep440', () => {
  it('writes a semantic prerelease the way Python spells it', () => {
    expect(toPep440('0.1.0-beta.1')).toBe('0.1.0b1');
    expect(toPep440('0.1.0-beta.12')).toBe('0.1.0b12');
    expect(toPep440('1.0.0-alpha.3')).toBe('1.0.0a3');
    expect(toPep440('1.0.0-rc.2')).toBe('1.0.0rc2');
  });

  it('leaves a stable version as it is', () => {
    expect(toPep440('1.2.3')).toBe('1.2.3');
  });

  it('refuses a version Python cannot express, instead of guessing', () => {
    for (const bad of [
      '1.0.0-next.0',
      '1.0.0-beta',
      '1.0',
      '1.0.0+build',
      '1.0.0-beta.1.2',
      'v1.0.0',
    ]) {
      expect(() => toPep440(bad), bad).toThrow('cannot be written as a Python version');
    }
  });
});

describe('the Python package version', () => {
  it("is package.json's version in Python's spelling, in pyproject.toml", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    const toml = fs.readFileSync(path.join(root, 'python', 'pyproject.toml'), 'utf8');
    expect(/^version = "([^"]+)"$/m.exec(toml)?.[1]).toBe(toPep440(pkg.version));
  });

  it('keeps the Python and Node floors in step with the package', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      engines: { node: string };
    };
    const toml = fs.readFileSync(path.join(root, 'python', 'pyproject.toml'), 'utf8');
    const floor = /nodejs-wheel-binaries>=([\d.]+)/.exec(toml)?.[1];
    expect(`>=${floor}`).toBe(pkg.engines.node);
  });
});
