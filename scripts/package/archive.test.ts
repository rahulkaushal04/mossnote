import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../../src/server/testing/helpers';
import { extract, pack, readFolder, unpack } from './archive';

let dir: string;
beforeEach(() => {
  dir = makeTempDir('moss-archive-');
});
afterEach(() => {
  removeDir(dir);
});

const file = (p: string, text: string, executable = false) => ({
  path: p,
  executable,
  data: Buffer.from(text),
});

describe('archive', () => {
  it('round-trips files, nested paths, empty files and binary bytes', () => {
    const binary = Buffer.from([0, 255, 1, 254, 0]);
    const files = [
      file('a.txt', 'hello'),
      file('deep/er/b.json', '{"ok":true}'),
      file('empty', ''),
      { path: 'bin/native.node', executable: false, data: binary },
    ];
    const back = unpack(pack(files));
    expect(back.map((f) => f.path)).toEqual(files.map((f) => f.path));
    expect(back.map((f) => f.data.toString('hex'))).toEqual(
      files.map((f) => f.data.toString('hex')),
    );
  });

  it('extracts into a folder and keeps runnable files runnable', () => {
    extract(pack([file('run.sh', '#!/bin/sh\n', true), file('lib/x.js', 'x')]), dir);
    expect(fs.readFileSync(path.join(dir, 'lib', 'x.js'), 'utf8')).toBe('x');
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(dir, 'run.sh')).mode & 0o111).not.toBe(0);
      expect(fs.statSync(path.join(dir, 'lib', 'x.js')).mode & 0o111).toBe(0);
    }
  });

  it('refuses paths that would leave the folder', () => {
    for (const bad of ['../escape', 'a/../../escape', '/etc/passwd', 'C:/x', 'a\\b', 'a//b', '']) {
      const raw = zlib.gunzipSync(pack([file('ok', 'x')]));
      const index = Buffer.from(JSON.stringify([{ path: bad, executable: false, size: 1 }]));
      const length = Buffer.alloc(4);
      length.writeUInt32LE(index.length);
      const forged = zlib.gzipSync(Buffer.concat([length, index, raw.subarray(raw.length - 1)]));
      expect(() => unpack(forged), bad).toThrow(/unsafe path/);
      expect(() => {
        extract(forged, path.join(dir, 'out'));
      }).toThrow();
    }
    expect(fs.existsSync(path.join(dir, 'escape'))).toBe(false);
  });

  it('reads a folder in a stable order, skipping what it is told to', () => {
    fs.mkdirSync(path.join(dir, 'src', 'skipme'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    fs.writeFileSync(path.join(dir, 'src', 'skipme', 'c.txt'), 'c');
    fs.writeFileSync(path.join(dir, 'src', 'd.txt'), 'd');
    const names = readFolder(dir, (relative) => relative.endsWith('skipme')).map((f) => f.path);
    expect(names).toEqual(['a.txt', 'b.txt', 'src/d.txt']);
  });
});
