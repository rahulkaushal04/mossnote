import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from './schema';

/**
 * The database types that portable server code depends on. Types only: this module never loads
 * a driver, so the services, the app and the migration runner can run in the Node server and in
 * the browser's worker alike. `db/client.ts` is the Node implementation; the browser has its own
 * in `src/standalone`.
 */

/** Drizzle over a synchronous SQLite driver, with this app's schema. */
export type Db = BetterSQLite3Database<typeof schema>;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/** A prepared statement. `raw(true)` makes `get` and `all` return rows as arrays. */
export interface Statement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  raw(toggle?: boolean): Statement;
}

/** The function `Sqlite.transaction` returns: call it to run the work, or pick a lock mode. */
export interface Transaction<Args extends unknown[], Result> {
  (...args: Args): Result;
  deferred(...args: Args): Result;
  immediate(...args: Args): Result;
  exclusive(...args: Args): Result;
}

/**
 * The part of a synchronous SQLite connection that this app uses. `better-sqlite3` satisfies it
 * as is; the browser runtime implements it over SQLite compiled to WebAssembly.
 */
export interface Sqlite {
  prepare(sql: string): Statement;
  exec(sql: string): unknown;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  transaction<Args extends unknown[], Result>(
    work: (...args: Args) => Result,
  ): Transaction<Args, Result>;
  /**
   * Write a consistent copy of the open database to `destination`, which is a file path in the
   * folder runtime and a name inside the browser's storage pool in the browser runtime.
   */
  backup(destination: string): Promise<unknown>;
  close(): unknown;
}

export interface Database {
  sqlite: Sqlite;
  db: Db;
}

export interface Clock {
  now(): number;
}
