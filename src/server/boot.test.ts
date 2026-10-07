import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeStartupError, IntegrityError, openJournal } from './boot';
import { ConfigError, loadConfig, type Config } from './config';
import { listSnapshots } from './db/backup';
import { openDatabase } from './db/client';
import { NewerJournalError } from './db/migrate';
import { AlreadyRunningError } from './lock';
import { silentLogger } from './logger';
import { fakeClock, makeTempDir, MIGRATIONS_FOLDER, removeDir } from './testing/helpers';

const DAY = 24 * 3_600_000;
let dir: string;
let config: Config;
const clock = fakeClock(new Date(2026, 9, 7, 9, 30).getTime());

const open = (pid?: number) =>
  openJournal({
    config,
    clock,
    logger: silentLogger,
    migrationsFolder: MIGRATIONS_FOLDER,
    ...(pid === undefined ? {} : { pid }),
  });

beforeEach(() => {
  dir = makeTempDir();
  config = loadConfig({ MOSS_DATA_DIR: path.join(dir, 'data') });
  clock.set(new Date(2026, 9, 7, 9, 30).getTime());
});
afterEach(() => {
  removeDir(dir);
});

describe('openJournal', () => {
  it('creates the data folder with restricted permissions, the database and the lock', async () => {
    const journal = await open();
    expect(fs.existsSync(config.dbPath)).toBe(true);
    expect(fs.existsSync(config.lockPath)).toBe(true);
    expect(fs.existsSync(config.backupsDir)).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(config.dataDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(config.dbPath).mode & 0o777).toBe(0o600);
    }
    expect(journal.migration.applied).toBe(4);
    journal.close();
    expect(fs.existsSync(config.lockPath)).toBe(false);
  });

  it('writes nothing outside the data folder', async () => {
    const journal = await open();
    journal.close();
    const entries = fs.readdirSync(dir);
    expect(entries).toEqual(['data']);
  });

  it('takes an automatic snapshot on the first start and not on an immediate restart', async () => {
    const first = await open();
    expect(first.snapshot?.reason).toBe('auto');
    first.close();

    clock.advance(2 * 3_600_000);
    const second = await open();
    expect(second.snapshot).toBeNull();
    second.close();
    expect(
      listSnapshots(config.backupsDir, 'journal').filter((s) => s.reason === 'auto'),
    ).toHaveLength(1);
  });

  it('takes another snapshot once the newest is more than 24 hours old', async () => {
    (await open()).close();
    clock.advance(DAY + 60_000);
    const again = await open();
    expect(again.snapshot?.reason).toBe('auto');
    again.close();
  });

  it('keeps existing data across restarts and snapshots it before a migration', async () => {
    const first = await open();
    first.database.sqlite
      .prepare(
        "INSERT INTO tags (id, name, name_key, pinned, created_at) VALUES ('t1', 'Idea', 'idea', 0, 1)",
      )
      .run();
    first.close();
    const second = await open();
    expect(second.migration.applied).toBe(0);
    expect(second.database.sqlite.prepare('SELECT count(*) AS n FROM tags').get()).toEqual({
      n: 1,
    });
    second.close();
  });

  it('refuses a second instance for the same journal and leaves the first intact', async () => {
    const first = await open();
    await expect(open(4_000_000)).rejects.toBeInstanceOf(AlreadyRunningError);
    expect(fs.existsSync(config.lockPath)).toBe(true);
    first.close();
  });

  it('allows two different journals side by side', async () => {
    const a = await open();
    const other = loadConfig({ MOSS_DATA_DIR: config.dataDir, MOSS_JOURNAL: 'second' });
    const b = await openJournal({
      config: other,
      clock,
      logger: silentLogger,
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    expect(fs.existsSync(path.join(config.dataDir, 'second.db'))).toBe(true);
    a.close();
    b.close();
  });

  it('refuses a journal from a newer version and releases the lock', async () => {
    (await open()).close();
    const raw = openDatabase(config.dbPath);
    raw.sqlite
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 9999999999999)",
      )
      .run();
    raw.sqlite.close();
    await expect(open()).rejects.toBeInstanceOf(NewerJournalError);
    expect(fs.existsSync(config.lockPath)).toBe(false);
  });

  it('refuses to start when the integrity check fails, naming the newest snapshot', async () => {
    const first = await open();
    const insert = first.database.sqlite.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 1)',
    );
    for (let i = 0; i < 3000; i++) insert.run(`k${i}`, `value ${i} `.repeat(8));
    first.database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    first.close();

    const bytes = fs.readFileSync(config.dbPath);
    for (let i = 8192; i < 16_384; i++) bytes[i] = 0xff;
    fs.writeFileSync(config.dbPath, bytes);
    fs.rmSync(`${config.dbPath}-wal`, { force: true });
    fs.rmSync(`${config.dbPath}-shm`, { force: true });

    const error = await open().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrityError);
    const failure = error as IntegrityError;
    expect(failure.problems.length).toBeGreaterThan(0);
    expect(failure.newest?.reason).toBe('auto');
    const lines = describeStartupError(failure, config).join('\n');
    expect(lines).toContain(failure.newest?.path);
    expect(lines).toContain(config.dbPath);
    expect(fs.existsSync(config.lockPath)).toBe(false);
  });
});

describe('describeStartupError', () => {
  it('prints the lock message with the PID and URL', () => {
    expect(describeStartupError(new AlreadyRunningError(4321), config)).toEqual([
      'Mossnote is already running (PID 4321) at http://127.0.0.1:4317.',
    ]);
  });

  it('prints the port and the variable to change when the port is in use', () => {
    const error = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    const [line] = describeStartupError(error, config);
    expect(line).toContain('4317');
    expect(line).toContain('MOSS_PORT');
  });

  it('prints the newer-version message', () => {
    expect(describeStartupError(new NewerJournalError(), config)).toEqual([
      'This journal was made by a newer version of Mossnote. Update Mossnote to open it. Nothing was changed.',
    ]);
  });

  it('prints the restore steps when integrity fails', () => {
    const snapshot = { name: 'n', path: '/x/n.db', reason: 'auto', takenAt: 0, size: 1 } as const;
    const lines = describeStartupError(
      new IntegrityError(['bad'], snapshot, config.dbPath),
      config,
    ).join('\n');
    expect(lines).toContain('/x/n.db');
    expect(lines).toContain('-wal');
    expect(lines).toContain('-shm');
  });

  it('prints configuration errors as they are', () => {
    expect(
      describeStartupError(new ConfigError('MOSS_PORT must be a whole number.'), config),
    ).toEqual(['MOSS_PORT must be a whole number.']);
  });
});
