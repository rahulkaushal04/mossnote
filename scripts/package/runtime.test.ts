import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../../src/server/testing/helpers';
import { pack } from './archive';
import { archiveId, ensureUnpacked, pruneOthers } from './runtime';

let root: string;
beforeEach(() => {
  root = path.join(makeTempDir('moss-runtime-'), 'cache');
});
afterEach(() => {
  removeDir(path.dirname(root));
});

const archive = pack([
  { path: 'dist/server/index.js', executable: false, data: Buffer.from('server') },
  { path: 'package.json', executable: false, data: Buffer.from('{}') },
]);

describe('the unpacked app', () => {
  it('has an id that changes with the version and with the bytes', () => {
    const other = pack([{ path: 'x', executable: false, data: Buffer.from('x') }]);
    expect(archiveId('1.0.0', archive)).toBe(archiveId('1.0.0', archive));
    expect(archiveId('1.0.1', archive)).not.toBe(archiveId('1.0.0', archive));
    expect(archiveId('1.0.0', other)).not.toBe(archiveId('1.0.0', archive));
  });

  it('is unpacked once and reused on the next start', () => {
    const first = ensureUnpacked({ archive, root, id: 'one' });
    expect(fs.readFileSync(path.join(first, 'dist', 'server', 'index.js'), 'utf8')).toBe('server');
    fs.writeFileSync(path.join(first, 'marker'), 'still here');
    const second = ensureUnpacked({ archive, root, id: 'one' });
    expect(second).toBe(first);
    expect(fs.readFileSync(path.join(second, 'marker'), 'utf8')).toBe('still here');
  });

  it('replaces a copy that was never finished', () => {
    fs.mkdirSync(path.join(root, 'one'), { recursive: true });
    fs.writeFileSync(path.join(root, 'one', 'half-written'), 'x');
    const target = ensureUnpacked({ archive, root, id: 'one' });
    expect(fs.existsSync(path.join(target, 'half-written'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'package.json'))).toBe(true);
  });

  it('leaves no staging folder behind and prunes other versions', () => {
    ensureUnpacked({ archive, root, id: 'old' });
    ensureUnpacked({ archive, root, id: 'new' });
    expect(fs.readdirSync(root).sort()).toEqual(['new', 'old']);
    pruneOthers(root, 'new');
    expect(fs.readdirSync(root)).toEqual(['new']);
    pruneOthers(path.join(root, 'missing'), 'new');
  });

  it('never writes outside the cache folder', () => {
    ensureUnpacked({ archive, root, id: 'one' });
    expect(fs.readdirSync(path.dirname(root))).toEqual(['cache']);
  });

  it('tries again when an antivirus scanner still holds the new files, then succeeds', () => {
    let calls = 0;
    const target = ensureUnpacked({
      archive,
      root,
      id: 'one',
      delayMs: 1,
      rename: (from, to) => {
        calls++;
        if (calls < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' });
        fs.renameSync(from, to);
      },
    });
    expect(calls).toBe(3);
    expect(fs.existsSync(path.join(target, '.ready'))).toBe(true);
    expect(fs.readdirSync(root)).toEqual(['one']);
  });

  it('gives up with the real error when the folder stays busy, and leaves nothing behind', () => {
    expect(() =>
      ensureUnpacked({
        archive,
        root,
        id: 'one',
        attempts: 3,
        delayMs: 1,
        rename: () => {
          throw Object.assign(new Error('still busy'), { code: 'EBUSY' });
        },
      }),
    ).toThrow('still busy');
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('does not retry an error that waiting cannot fix', () => {
    let calls = 0;
    expect(() =>
      ensureUnpacked({
        archive,
        root,
        id: 'one',
        delayMs: 1,
        rename: () => {
          calls++;
          throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
        },
      }),
    ).toThrow('no space');
    expect(calls).toBe(1);
  });

  it('uses the copy another program finished first', () => {
    const target = ensureUnpacked({
      archive,
      root,
      id: 'one',
      rename: () => {
        fs.mkdirSync(path.join(root, 'one'), { recursive: true });
        fs.writeFileSync(path.join(root, 'one', '.ready'), 'one');
        throw Object.assign(new Error('exists'), { code: 'EPERM' });
      },
    });
    expect(fs.existsSync(path.join(target, '.ready'))).toBe(true);
  });

  it('removes staging folders that a crash left behind, but not one that is still being made', () => {
    ensureUnpacked({ archive, root, id: 'new' });
    fs.mkdirSync(path.join(root, 'new.unpacking-2147483646'));
    fs.mkdirSync(path.join(root, `old.unpacking-${process.pid}`));
    pruneOthers(root, 'new');
    expect(fs.readdirSync(root).sort()).toEqual(['new', `old.unpacking-${process.pid}`]);
  });
});
