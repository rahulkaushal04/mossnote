import { createMemoryPool } from '../pool/memoryPool';
import type { FilePool } from '../pool/types';
import type { Sqlite3 } from '../sqlite/connection';
import { loadSqlite } from '../sqlite/load';

let loading: Promise<Sqlite3> | undefined;

/** SQLite WebAssembly, started once per test file. Under Node it is the library's Node build. */
export function sqliteForTests(): Promise<Sqlite3> {
  loading ??= loadSqlite();
  return loading;
}

/** A fresh in-memory pool. */
export async function memoryPoolForTests(): Promise<FilePool> {
  return createMemoryPool(await sqliteForTests());
}
