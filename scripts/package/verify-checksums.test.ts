import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../../src/server/testing/helpers';
import { verifyChecksums } from './verify-checksums';

let folder: string;
beforeEach(() => {
  folder = makeTempDir('moss-sums-');
});
afterEach(() => {
  removeDir(folder);
});

const sum = (data: string) => crypto.createHash('sha256').update(data).digest('hex');
function add(name: string, data: string, sumText = `${sum(data)}  ${name}\n`) {
  fs.writeFileSync(path.join(folder, name), data);
  fs.writeFileSync(path.join(folder, `${name}.sha256`), sumText);
}

describe('verifyChecksums', () => {
  it('accepts files whose checksums match', () => {
    add('mossnote-v1-linux-x64.tar.gz', 'program');
    add('mossnote-v1-win-x64.exe', 'exe');
    expect(verifyChecksums(folder)).toEqual([]);
  });

  it('finds a file that changed after its checksum was made', () => {
    add('a.tar.gz', 'one');
    fs.writeFileSync(path.join(folder, 'a.tar.gz'), 'two');
    expect(verifyChecksums(folder)[0]).toContain('a.tar.gz: checksum is');
  });

  it('finds a checksum for a file that is not there, a file with no checksum, and a wrong name', () => {
    add('a.tar.gz', 'one');
    fs.rmSync(path.join(folder, 'a.tar.gz'));
    fs.writeFileSync(path.join(folder, 'b.exe'), 'x');
    add('c.exe', 'c', `${sum('c')}  other.exe\n`);
    const problems = verifyChecksums(folder).join('\n');
    expect(problems).toContain('a.tar.gz is missing');
    expect(problems).toContain('b.exe has no .sha256 file');
    expect(problems).toContain('c.exe.sha256 names other.exe');
  });

  it('ignores folders', () => {
    add('a.exe', 'x');
    fs.mkdirSync(path.join(folder, 'python'));
    expect(verifyChecksums(folder)).toEqual([]);
  });

  it('refuses a folder with no checksums and a malformed checksum file', () => {
    expect(verifyChecksums(folder)[0]).toContain('holds no .sha256 file');
    add('a.exe', 'x', 'not a checksum\n');
    expect(verifyChecksums(folder).join('\n')).toContain('is not "<sha256>  <file name>"');
  });
});
