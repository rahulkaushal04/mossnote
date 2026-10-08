import type BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import type { Db, Sqlite } from './types';

/**
 * Drizzle over a synchronous SQLite connection. Used by the Node server (over `better-sqlite3`)
 * and by the browser runtime (over SQLite in WebAssembly): Drizzle's driver only calls the part
 * of the connection that {@link Sqlite} describes.
 */
export function createDb(sqlite: Sqlite): Db {
  // Drizzle's types name better-sqlite3's connection class. Every method it calls on the
  // connection is in `Sqlite`, which the browser connection implements (see its tests), so the
  // narrower type is safe to pass where the class is expected.
  return drizzle(sqlite as unknown as BetterSqlite3.Database, {
    schema,
    casing: 'snake_case',
  });
}
