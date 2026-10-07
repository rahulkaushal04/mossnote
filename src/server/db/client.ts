import fs from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export type Sqlite = BetterSqlite3.Database;

export interface Database {
  sqlite: Sqlite;
  db: Db;
}

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
  return { sqlite, db: drizzle(sqlite, { schema, casing: 'snake_case' }) };
}
