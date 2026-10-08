import { loadMigrations } from '@server/db/migrate';
import { migrateWith } from '@server/db/migrations';
import { createDb } from '@server/db/orm';
import type { Database } from '@server/db/types';
import { noStorage } from '@server/services/storage';
import fs from 'node:fs';
import { createConnection } from '../sqlite/connection';
import { sqliteForTests } from './sqlite';

/** Where the real migrations are, as the server's tests find them. */
export interface MemoryDatabaseOptions {
  migrationsFolder: string;
  clock: { now(): number };
}

/**
 * A migrated in-memory database on SQLite in WebAssembly, the counterpart of the server tests'
 * `migratedMemoryDatabase()`. The "wasm" test run swaps this in so the whole server test suite
 * proves the browser's SQLite behaves like the Node one.
 */
export async function wasmMemoryDatabase(options: MemoryDatabaseOptions): Promise<Database> {
  const sqlite3 = await sqliteForTests();
  const wasmDatabase = new sqlite3.oo1.DB(':memory:');
  // The server's tests keep snapshots as real files, so a backup is written to the path it is given.
  const sqlite = createConnection(sqlite3, wasmDatabase, {
    backup(destination) {
      if (wasmDatabase.pointer === undefined) throw new Error('The database is closed.');
      fs.writeFileSync(destination, sqlite3.capi.sqlite3_js_db_export(wasmDatabase.pointer));
      return Promise.resolve();
    },
  });
  sqlite.pragma('foreign_keys = ON');
  const database: Database = { sqlite, db: createDb(sqlite) };
  await migrateWith({
    database,
    migrations: loadMigrations(options.migrationsFolder),
    snapshots: noStorage.snapshots,
    journal: 'journal',
    clock: options.clock,
    autoKeep: 14,
  });
  return database;
}
