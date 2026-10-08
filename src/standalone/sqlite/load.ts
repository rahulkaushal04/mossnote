import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { SAHPoolUtil } from '@sqlite.org/sqlite-wasm';
import type { Sqlite3 } from './connection';

/**
 * Starting SQLite in the browser. Kept apart from the connection code so tests can start the
 * Node build of the same library instead.
 */

/** Where the browser keeps the files, under the origin private file system root. */
export const POOL_DIRECTORY = '/mossnote';
/** Files the pool can hold before it has to grow. */
const INITIAL_CAPACITY = 24;

export async function loadSqlite(): Promise<Sqlite3> {
  return sqlite3InitModule();
}

/** Open the storage pool. Fails when another tab already has it open. */
export function openStoragePool(sqlite3: Sqlite3): Promise<SAHPoolUtil> {
  return sqlite3.installOpfsSAHPoolVfs({
    directory: POOL_DIRECTORY,
    initialCapacity: INITIAL_CAPACITY,
  });
}
