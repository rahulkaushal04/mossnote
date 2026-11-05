import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { copyOut } from './copyOut.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mossnote-copy-'));

describe('copyOut (save copy)', () => {
  it('writes the bytes, replaces an existing file, leaves no temp file, and is not executable', async () => {
    const dir = tmp();
    const dest = path.join(dir, 'out.png');
    fs.writeFileSync(dest, 'old');
    await copyOut(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), dest);
    expect(fs.readFileSync(dest, 'utf8')).toBe('abcd');
    expect(fs.readdirSync(dir)).toEqual(['out.png']);
    if (process.platform !== 'win32') expect(fs.statSync(dest).mode & 0o111).toBe(0);
  });
  it('a failing source leaves the old file untouched and no temp file', async () => {
    const dir = tmp();
    const dest = path.join(dir, 'out.png');
    fs.writeFileSync(dest, 'old');
    const bad = new Readable({
      read() {
        this.destroy(new Error('disk gone'));
      },
    });
    await expect(copyOut(bad, dest)).rejects.toThrow('disk gone');
    expect(fs.readFileSync(dest, 'utf8')).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['out.png']);
  });
});
