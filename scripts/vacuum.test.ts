import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config';
import { openJournal } from '../src/server/boot';
import { silentLogger } from '../src/server/logger';
import { AlreadyRunningError } from '../src/server/lock';
import {
  fakeClock,
  makeTempDir,
  MIGRATIONS_FOLDER,
  removeDir,
} from '../src/server/testing/helpers';
import { vacuumJournal } from './vacuum';

let dir: string;
beforeEach(() => {
  dir = makeTempDir();
});
afterEach(() => {
  removeDir(dir);
});

const open = (config: ReturnType<typeof loadConfig>) =>
  openJournal({
    config,
    clock: fakeClock(),
    logger: silentLogger,
    migrationsFolder: MIGRATIONS_FOLDER,
  });

describe('vacuumJournal', () => {
  it('shrinks a journal with free pages and keeps its data', async () => {
    const config = loadConfig({ MOSS_DATA_DIR: dir });
    const journal = await open(config);
    const insert = journal.database.sqlite.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 1)',
    );
    for (let i = 0; i < 2000; i++) insert.run(`filler${i}`, 'x'.repeat(200));
    journal.database.sqlite.exec("DELETE FROM settings WHERE key LIKE 'filler%'");
    journal.close();

    const result = vacuumJournal(config);
    expect(result.after).toBeLessThan(result.before);
    const again = await open(config);
    const keys = (
      again.database.sqlite.prepare('SELECT key FROM settings ORDER BY key').all() as {
        key: string;
      }[]
    ).map((r) => r.key);
    expect(keys).toEqual(['calendar', 'layout', 'meta']);
    again.close();
    expect(fs.existsSync(path.join(dir, 'journal.lock'))).toBe(false);
  });

  it('refuses while the app is running', async () => {
    const config = loadConfig({ MOSS_DATA_DIR: dir });
    const journal = await openJournal({
      config,
      clock: fakeClock(),
      logger: silentLogger,
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    // The vacuum runs as a different process from the one holding the lock.
    expect(() => vacuumJournal(config, 4_000_000)).toThrow(AlreadyRunningError);
    journal.close();
  });
});
