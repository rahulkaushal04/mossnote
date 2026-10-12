import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../testing/helpers';
import { LEFTOVER_MAX_AGE_MS, removeLeftovers } from './leftovers';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const HOUR = 3_600_000;

let dataDir: string;
let backupsDir: string;
beforeEach(() => {
  const dir = makeTempDir();
  dataDir = path.join(dir, 'data');
  backupsDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
});
afterEach(() => {
  removeDir(path.dirname(dataDir));
});

/** Plant a file last written `ageMs` before NOW. */
const plant = (file: string, ageMs: number, content = 'x'.repeat(100)): string => {
  fs.writeFileSync(file, content);
  const when = (NOW - ageMs) / 1000;
  fs.utimesSync(file, when, when);
  return file;
};
const clean = (journal = 'work') => removeLeftovers({ dataDir, backupsDir, journal, now: NOW });
const partial = (journal: string, stamp = '20261007-0900') =>
  path.join(backupsDir, `${journal}-${stamp}-auto.db.partial`);

describe('removeLeftovers', () => {
  it('removes an old partial snapshot, and keeps a recent one that another Mossnote may be writing', () => {
    const old = plant(partial('other', '20261007-0800'), 2 * HOUR);
    const recent = plant(partial('other', '20261007-1150'), 5 * 60_000);

    expect(clean()).toBe(1);

    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it('removes a partial snapshot of the journal being opened at once, because its lock is held', () => {
    const own = plant(partial('work', '20261007-1155'), 60_000);

    expect(clean('work')).toBe(1);

    expect(fs.existsSync(own)).toBe(false);
  });

  it('knows a journal whose name has hyphens, numbers and a sequence', () => {
    const own = plant(path.join(backupsDir, 'my-game-2-20261007-1155-3-manual.db.partial'), 1_000);
    const other = plant(path.join(backupsDir, 'my-game-20261007-1155-manual.db.partial'), 1_000);

    clean('my-game-2');

    expect(fs.existsSync(own)).toBe(false);
    expect(fs.existsSync(other)).toBe(true);
  });

  it('removes a staged restore of this journal at once and any other one once it is old', () => {
    const own = plant(path.join(dataDir, 'work.db.restoring'), 1_000);
    const oldOther = plant(path.join(dataDir, 'other.db.restoring'), 3 * HOUR);
    const freshOther = plant(path.join(dataDir, 'third.db.restoring'), 1_000);

    expect(clean('work')).toBe(2);

    expect(fs.existsSync(own)).toBe(false);
    expect(fs.existsSync(oldOther)).toBe(false);
    expect(fs.existsSync(freshOther)).toBe(true);
  });

  it('removes an old temporary copy of the paired devices and keeps a recent one', () => {
    const old = plant(path.join(dataDir, 'phone-devices.json.4242.tmp'), 2 * HOUR);
    const recent = plant(path.join(dataDir, 'phone-devices.json.4343.tmp'), 1_000);

    expect(clean()).toBe(1);

    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it('removes the rollback file SQLite leaves beside a partial snapshot, together with it', () => {
    const oldMain = plant(partial('other', '20261007-0800'), 2 * HOUR);
    const oldJournal = plant(`${oldMain}-journal`, 2 * HOUR);
    const recentMain = plant(partial('other', '20261007-1150'), 60_000);
    // The rollback file is written at the start of the backup, so it can look older than the copy.
    const recentJournal = plant(`${recentMain}-journal`, 2 * HOUR);
    const ownMain = plant(partial('work', '20261007-1155'), 1_000);
    const ownJournal = plant(`${ownMain}-journal`, 1_000);

    expect(clean('work')).toBe(4);

    for (const file of [oldMain, oldJournal, ownMain, ownJournal]) {
      expect(fs.existsSync(file), file).toBe(false);
    }
    expect(fs.existsSync(recentMain)).toBe(true);
    expect(fs.existsSync(recentJournal)).toBe(true);
  });

  it('removes the files beside a partial snapshot that it removes, whatever their own age', () => {
    const main = plant(partial('other', '20261007-0800'), 2 * HOUR);
    const journal = plant(`${main}-journal`, 1_000);

    expect(clean()).toBe(2);

    expect(fs.existsSync(main)).toBe(false);
    expect(fs.existsSync(journal)).toBe(false);
  });

  it('removes a rollback or log file whose snapshot copy is gone, once it is old', () => {
    const oldOrphan = plant(`${partial('other', '20261007-0800')}-journal`, 2 * HOUR);
    const oldWal = plant(`${partial('other', '20261007-0801')}-wal`, 2 * HOUR);
    const recentOrphan = plant(`${partial('other', '20261007-1155')}-journal`, 1_000);

    expect(clean()).toBe(2);

    expect(fs.existsSync(oldOrphan)).toBe(false);
    expect(fs.existsSync(oldWal)).toBe(false);
    expect(fs.existsSync(recentOrphan)).toBe(true);
  });

  it('treats the age limit as an hour, and a file from the future as recent', () => {
    expect(LEFTOVER_MAX_AGE_MS).toBe(HOUR);
    const justOver = plant(partial('other', '20261007-0000'), HOUR);
    const justUnder = plant(partial('other', '20261007-0001'), HOUR - 60_000);
    const future = plant(partial('other', '20261007-0002'), -HOUR);

    expect(clean()).toBe(1);

    expect(fs.existsSync(justOver)).toBe(false);
    expect(fs.existsSync(justUnder)).toBe(true);
    expect(fs.existsSync(future)).toBe(true);
  });

  it('never touches journals, snapshots, the device list or anything it does not know', () => {
    const keep = [
      plant(path.join(dataDir, 'work.db'), 9 * HOUR),
      plant(path.join(dataDir, 'work.db-wal'), 9 * HOUR),
      plant(path.join(dataDir, 'work.lock'), 9 * HOUR),
      plant(path.join(dataDir, 'active-journal'), 9 * HOUR),
      plant(path.join(dataDir, 'phone-devices.json'), 9 * HOUR),
      plant(path.join(dataDir, 'notes.tmp'), 9 * HOUR),
      plant(path.join(dataDir, 'phone-devices.json.abc.tmp'), 9 * HOUR),
      plant(path.join(backupsDir, 'work-20261001-0900-auto.db'), 9 * HOUR),
      plant(path.join(backupsDir, 'readme.partial'), 9 * HOUR),
      plant(path.join(backupsDir, 'work-20261001-0900-auto.partial'), 9 * HOUR),
    ];
    const folder = path.join(backupsDir, 'old-20261001-0900-auto.db.partial');
    fs.mkdirSync(folder);

    expect(clean()).toBe(0);

    for (const file of keep) expect(fs.existsSync(file), file).toBe(true);
    expect(fs.statSync(folder).isDirectory()).toBe(true);
  });

  it('copes with missing folders and with files that cannot be removed', () => {
    fs.rmSync(backupsDir, { recursive: true });
    expect(clean()).toBe(0);
    expect(
      removeLeftovers({ dataDir: path.join(dataDir, 'nope'), backupsDir, journal: 'w', now: NOW }),
    ).toBe(0);
  });
});
