import fs from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import { createDb } from './orm';
import type { Database } from './types';

export type { Database, Db, Sqlite } from './types';

/**
 * Open the journal with the journal pragmas, set on every open.
 * Pass `:memory:` for tests. The database file is restricted to the owner (mode 0600) where
 * the platform supports it.
 */
export function openDatabase(filename: string): Database {
  const sqlite = new BetterSqlite3(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');

  if (filename !== ':memory:') {
    try {
      fs.chmodSync(filename, 0o600);
    } catch {
      // Platforms without POSIX modes: nothing to do.
    }
  }
  return { sqlite, db: createDb(sqlite) };
}

/**
 * Open a journal for reading only: no pragmas, no migration, no writes of any kind. For looking
 * at a journal that is not the open one.
 */
export function openDatabaseReadOnly(filename: string): Database {
  const sqlite = new BetterSqlite3(filename, { readonly: true, fileMustExist: true });
  return { sqlite, db: createDb(sqlite) };
}
