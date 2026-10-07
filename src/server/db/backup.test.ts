import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  autoSnapshotDue,
  createSnapshot,
  integrityCheck,
  listSnapshots,
  newestSnapshot,
  retentionFor,
  snapshotIfDue,
  snapshotName,
  type BackupReason,
} from './backup';
import { openDatabase, type Database } from './client';
import { fakeClock, makeTempDir, migratedMemoryDatabase, removeDir } from '../testing/helpers';

const HOUR = 3_600_000;
let dir: string;
let backupsDir: string;
let database: Database;
const clock = fakeClock(new Date(2026, 9, 7, 9, 30).getTime());

beforeEach(async () => {
  dir = makeTempDir();
  backupsDir = path.join(dir, 'backups');
  database = openDatabase(path.join(dir, 'journal.db'));
  const { migrateDatabase } = await import('./migrate');
  const { MIGRATIONS_FOLDER } = await import('../testing/helpers');
  await migrateDatabase({
    database,
    migrationsFolder: MIGRATIONS_FOLDER,
    backupsDir,
    journal: 'journal',
    clock,
    autoKeep: 14,
  });
  clock.set(new Date(2026, 9, 7, 9, 30).getTime());
});
afterEach(() => {
  database.sqlite.close();
  removeDir(dir);
});

const snap = (reason: BackupReason, autoKeep = 14) =>
  createSnapshot({
    sqlite: database.sqlite,
    backupsDir,
    journal: 'journal',
    reason,
    clock,
    autoKeep,
  });

describe('snapshotName', () => {
  it('uses journal, local date, local time and reason', () => {
    const at = new Date(2026, 9, 7, 9, 5).getTime();
    expect(snapshotName('journal', at, 'auto')).toBe('journal-20261007-0905-auto.db');
    expect(snapshotName('journal', at, 'pre-import')).toBe('journal-20261007-0905-pre-import.db');
    expect(snapshotName('second', at, 'manual', 3)).toBe('second-20261007-0905-3-manual.db');
  });
});

describe('createSnapshot', () => {
  it('produces a valid database containing the data, even while the source is in WAL mode', async () => {
    database.sqlite
      .prepare(
        "INSERT INTO tags (id, name, name_key, pinned, created_at) VALUES ('t1', 'Idea', 'idea', 0, 1)",
      )
      .run();
    expect(database.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    const made = await snap('manual');

    expect(made.name).toBe('journal-20261007-0930-manual.db');
    expect(fs.existsSync(made.path)).toBe(true);
    expect(fs.existsSync(`${made.path}.partial`)).toBe(false);
    const copy = openDatabase(made.path);
    expect(integrityCheck(copy.sqlite)).toEqual([]);
    expect(copy.sqlite.prepare('SELECT name FROM tags').all()).toEqual([{ name: 'Idea' }]);
    copy.sqlite.close();
  });

  it('restricts the snapshot to the owner', async () => {
    if (process.platform === 'win32') return;
    const made = await snap('manual');
    expect(fs.statSync(made.path).mode & 0o777).toBe(0o600);
    expect(fs.statSync(backupsDir).mode & 0o777).toBe(0o700);
  });

  it('never overwrites a snapshot taken in the same minute', async () => {
    const a = await snap('manual');
    const b = await snap('manual');
    const c = await snap('manual');
    expect(new Set([a.name, b.name, c.name]).size).toBe(3);
    expect(listSnapshots(backupsDir, 'journal').map((s) => s.name)).toEqual([
      'journal-20261007-0930-manual.db',
      'journal-20261007-0930-2-manual.db',
      'journal-20261007-0930-3-manual.db',
    ]);
  });

  it('records reason and time in the listing', async () => {
    await snap('pre-import');
    const [only] = listSnapshots(backupsDir, 'journal');
    expect(only).toMatchObject({ reason: 'pre-import', takenAt: clock.now() });
    expect(only?.size).toBeGreaterThan(0);
  });

  it('cleans up the partial file when the backup fails', async () => {
    const closed = openDatabase(path.join(dir, 'closed.db'));
    closed.sqlite.close();
    await expect(
      createSnapshot({
        sqlite: closed.sqlite,
        backupsDir,
        journal: 'journal',
        reason: 'auto',
        clock,
        autoKeep: 14,
      }),
    ).rejects.toThrow();
    expect(fs.readdirSync(backupsDir).filter((f) => f.endsWith('.partial'))).toEqual([]);
  });
});

describe('bursts of snapshots in one minute', () => {
  it('keeps the newest ones and never loses the snapshot that was just taken', async () => {
    const made: string[] = [];
    for (let i = 0; i < 12; i++) made.push((await snap('pre-import')).name);
    const kept = listSnapshots(backupsDir, 'journal')
      .filter((s) => s.reason === 'pre-import')
      .map((s) => s.name);
    expect(kept).toHaveLength(5);
    // The last five taken are exactly the five kept, and each one existed when it was returned.
    expect(kept).toEqual(made.slice(-5));
    expect(new Set(made).size).toBe(12);
  });

  it('keeps counting up after older numbers were pruned', async () => {
    for (let i = 0; i < 7; i++) await snap('pre-import');
    const next = await snap('pre-import');
    expect(next.name).toBe('journal-20261007-0930-8-pre-import.db');
  });
});

describe('retention', () => {
  it('has the documented limits', () => {
    expect(retentionFor('auto', 14)).toBe(14);
    expect(retentionFor('auto', 5)).toBe(5);
    expect(retentionFor('pre-migration', 14)).toBe(3);
    expect(retentionFor('pre-import', 14)).toBe(5);
    expect(retentionFor('manual', 14)).toBeNull();
  });

  const take = async (reason: BackupReason, times: number, autoKeep = 14) => {
    for (let i = 0; i < times; i++) {
      clock.advance(60_000);
      await snap(reason, autoKeep);
    }
  };
  const names = (reason: BackupReason) =>
    listSnapshots(backupsDir, 'journal').filter((s) => s.reason === reason);

  it('keeps the newest N auto snapshots', async () => {
    await take('auto', 5, 3);
    const kept = names('auto');
    expect(kept).toHaveLength(3);
    expect(kept.at(-1)?.takenAt).toBe(clock.now());
  });

  it('keeps the newest 3 pre-migration and 5 pre-import snapshots', async () => {
    await take('pre-migration', 6);
    await take('pre-import', 8);
    expect(names('pre-migration')).toHaveLength(3);
    expect(names('pre-import')).toHaveLength(5);
  });

  it('never prunes manual snapshots, and reasons do not affect each other', async () => {
    await take('manual', 20);
    await take('auto', 20, 2);
    expect(names('manual')).toHaveLength(20);
    expect(names('auto')).toHaveLength(2);
  });

  it('ignores other journals and unrelated files', async () => {
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(path.join(backupsDir, 'second-20261007-0930-auto.db'), 'x');
    fs.writeFileSync(path.join(backupsDir, 'notes.txt'), 'x');
    await take('auto', 4, 1);
    expect(fs.existsSync(path.join(backupsDir, 'second-20261007-0930-auto.db'))).toBe(true);
    expect(fs.existsSync(path.join(backupsDir, 'notes.txt'))).toBe(true);
    expect(names('auto')).toHaveLength(1);
  });
});

describe('automatic snapshots (24-hour rule)', () => {
  it('is due when there is no auto snapshot', () => {
    expect(autoSnapshotDue(backupsDir, 'journal', clock.now())).toBe(true);
  });

  it('is not due within 24 hours, and is due after', async () => {
    await snap('auto');
    expect(autoSnapshotDue(backupsDir, 'journal', clock.now() + 23 * HOUR + 59 * 60_000)).toBe(
      false,
    );
    expect(autoSnapshotDue(backupsDir, 'journal', clock.now() + 24 * HOUR)).toBe(false);
    expect(autoSnapshotDue(backupsDir, 'journal', clock.now() + 24 * HOUR + 60_000)).toBe(true);
  });

  it('is not satisfied by other snapshot reasons', async () => {
    await snap('manual');
    await snap('pre-import');
    expect(autoSnapshotDue(backupsDir, 'journal', clock.now())).toBe(true);
  });

  it('snapshotIfDue takes one on first start and skips an immediate second start', async () => {
    const options = {
      sqlite: database.sqlite,
      backupsDir,
      journal: 'journal',
      clock,
      autoKeep: 14,
    };
    expect(await snapshotIfDue(options)).not.toBeNull();
    expect(await snapshotIfDue(options)).toBeNull();
    clock.advance(25 * HOUR);
    expect(await snapshotIfDue(options)).not.toBeNull();
    expect(listSnapshots(backupsDir, 'journal').filter((s) => s.reason === 'auto')).toHaveLength(2);
  });
});

describe('integrity check and newest snapshot', () => {
  it('reports a healthy database as no problems', () => {
    expect(integrityCheck(database.sqlite)).toEqual([]);
  });

  it('detects a corrupted database file', () => {
    const file = path.join(dir, 'broken.db');
    const broken = openDatabase(file);
    broken.sqlite.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const insert = broken.sqlite.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < 2000; i++) insert.run(`value number ${i} `.repeat(5));
    broken.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    broken.sqlite.close();

    const bytes = fs.readFileSync(file);
    for (let i = 8192; i < 12_288; i++) bytes[i] = 0xff;
    fs.writeFileSync(file, bytes);

    let problems: string[];
    try {
      const reopened = openDatabase(file);
      problems = integrityCheck(reopened.sqlite);
      reopened.sqlite.close();
    } catch {
      problems = ['could not open'];
    }
    expect(problems.length).toBeGreaterThan(0);
  });

  it('finds the newest snapshot of any reason, or null', async () => {
    expect(newestSnapshot(backupsDir, 'journal')).toBeNull();
    await snap('auto');
    clock.advance(60_000);
    const latest = await snap('pre-import');
    expect(newestSnapshot(backupsDir, 'journal')?.name).toBe(latest.name);
  });

  it('works on an in-memory database too', async () => {
    const memory = await migratedMemoryDatabase();
    expect(integrityCheck(memory.sqlite)).toEqual([]);
    memory.sqlite.close();
  });
});
