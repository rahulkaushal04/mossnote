import type { Database as WasmDatabase } from '@sqlite.org/sqlite-wasm';
import { createConnection, type Sqlite3 } from '../sqlite/connection';
import type { FilePool } from './types';

/**
 * A {@link FilePool} that keeps its files in memory. For tests: it lets the browser runtime run
 * under Node, with the same SQLite and the same SQL as in the browser, but no browser storage.
 */
export function createMemoryPool(sqlite3: Sqlite3): FilePool {
  const { capi, wasm } = sqlite3;
  const files = new Map<string, Uint8Array>();
  const open = new Map<string, WasmDatabase>();

  const exportOpen = (db: WasmDatabase): Uint8Array => {
    if (db.pointer === undefined) throw new Error('The database is closed.');
    return capi.sqlite3_js_db_export(db.pointer);
  };

  const load = (db: WasmDatabase, bytes: Uint8Array): void => {
    const copy = wasm.allocFromTypedArray(bytes);
    const flags = capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE;
    db.checkRc(capi.sqlite3_deserialize(db, 'main', copy, bytes.length, bytes.length, flags));
  };

  return {
    names: () => [...new Set([...files.keys(), ...open.keys()])].sort(),
    has: (name) => files.has(name) || open.has(name),
    open(name) {
      if (open.has(name)) throw new Error(`${name} is already open.`);
      const db = new sqlite3.oo1.DB(':memory:');
      const stored = files.get(name);
      if (stored) load(db, stored);
      open.set(name, db);
      return createConnection(sqlite3, db, {
        backup: (destination) => {
          const copy = new sqlite3.oo1.DB(':memory:');
          try {
            load(copy, exportOpen(db));
            copy.exec('VACUUM');
            files.set(destination, exportOpen(copy));
          } finally {
            copy.close();
          }
          return Promise.resolve();
        },
        beforeClose() {
          files.set(name, exportOpen(db));
          open.delete(name);
        },
      });
    },
    read(name) {
      const live = open.get(name);
      const bytes = live ? exportOpen(live) : files.get(name);
      if (!bytes) throw new Error(`${name} does not exist.`);
      return bytes.slice();
    },
    write(name, bytes) {
      if (open.has(name)) throw new Error(`${name} is open.`);
      files.set(name, bytes.slice());
      return Promise.resolve();
    },
    remove(name) {
      if (open.has(name)) throw new Error(`${name} is open.`);
      return files.delete(name);
    },
    reserve: () => Promise.resolve(),
  };
}
