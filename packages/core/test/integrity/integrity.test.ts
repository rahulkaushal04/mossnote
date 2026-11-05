import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  truncateSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../src/db/hash.ts';
import { integrityGuard, type RecoveryInfo } from '../../src/integrity/index.ts';
import { openStore } from '../../src/store/store.ts';
import { FIXED, open, tmp } from '../store/helpers.ts';

// A read-only open of a WAL-mode db may create an empty -wal; a missing and an empty -wal are the same content.
const hashOf = (p: string) => sha256(existsSync(p) ? readFileSync(p) : '');

function makeDb(dir: string): string {
  const p = join(dir, 'n.db');
  open(p, { clock: FIXED }).close(); // close checkpoints: the main file is complete
  return p;
}

describe('CS-9 integrity check before any read-write open', () => {
  it.each([
    ['garbage header', (p: string) => writeFileSync(p, Buffer.alloc(8192, 0x41))],
    [
      'zeroed page 2',
      (p: string) => {
        const b = readFileSync(p);
        b.fill(0, 4096, 8192);
        writeFileSync(p, b);
      },
    ],
    ['truncated file', (p: string) => truncateSync(p, 5000)],
    [
      'scribbled interior pages',
      (p: string) => {
        const b = readFileSync(p);
        for (let i = 4096; i < b.length; i += 7) b[i] = (b[i]! + 1) & 0xff;
        writeFileSync(p, b);
      },
    ],
  ])('%s: corrupt error, db and -wal byte-identical, backups listed', (_n, damage) => {
    const dir = tmp();
    const p = makeDb(dir);
    mkdirSync(join(dir, 'backups'));
    copyFileSync(p, join(dir, 'backups', 'pre-migration-v1-X.sqlite')); // good backup
    writeFileSync(join(dir, 'backups', 'junk.sqlite'), 'not a db');
    damage(p);
    const before = [hashOf(p), hashOf(`${p}-wal`)];
    const r = openStore(p, { guards: [integrityGuard] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('corrupt');
    const info = r.error.cause as RecoveryInfo;
    expect(info.backups.map((b) => [b.path.split('/').pop(), b.verified]).sort()).toEqual([
      ['junk.sqlite', false],
      ['pre-migration-v1-X.sqlite', true],
    ]);
    expect([hashOf(p), hashOf(`${p}-wal`)]).toEqual(before);
    expect(existsSync(p)).toBe(true);
  });

  it('a healthy db and a brand-new path pass the guard', () => {
    const dir = tmp();
    const p = makeDb(dir);
    expect(open(p, { guards: [integrityGuard] }).path).toBe(p);
    expect(open(join(dir, 'fresh', 'n.db'), { guards: [integrityGuard] }).path).toContain('fresh');
  });
});
