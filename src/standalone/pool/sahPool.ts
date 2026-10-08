import type { SAHPoolUtil } from '@sqlite.org/sqlite-wasm';
import { createConnection, type Sqlite3 } from '../sqlite/connection';
import type { FilePool } from './types';

/**
 * A {@link FilePool} in the browser's origin private file system, through SQLite's "SAH pool"
 * file system. It needs no special response headers, which is why it works on a static host such
 * as GitHub Pages, but it keeps its files open for the life of the page: only one tab can use it
 * at a time (see `lib/standalone/storageLock.ts` in the web app).
 */

/** Extra files SQLite creates beside an open database (its rollback journal), per database. */
const TEMPORARY_FILES_PER_DATABASE = 2;
/** Files kept free beyond what is needed now, so most writes never wait for more room. */
const SPARE_FILES = 8;

/** The names SQLite gives the temporary files it keeps beside a database. */
const TEMPORARY_SUFFIX = /-(?:journal|wal|shm)$/;

export function createSahPool(sqlite3: Sqlite3, util: SAHPoolUtil): FilePool {
  const open = new Set<string>();

  const pool: FilePool = {
    names: () => util.getFileNames().filter((name) => !TEMPORARY_SUFFIX.test(name)),
    has: (name) => util.getFileNames().includes(name),
    open(name) {
      if (open.has(name)) throw new Error(`${name} is already open.`);
      open.add(name);
      const db = new util.OpfsSAHPoolDb(name);
      return createConnection(sqlite3, db, {
        backup: async (destination) => {
          await pool.reserve(1);
          db.exec('VACUUM INTO ?', { bind: [destination] });
        },
        beforeClose() {
          open.delete(name);
        },
      });
    },
    read(name) {
      return util.exportFile(name);
    },
    async write(name, bytes) {
      if (open.has(name)) throw new Error(`${name} is open.`);
      await pool.reserve(1);
      await util.importDb(name, bytes);
    },
    remove(name) {
      if (open.has(name)) throw new Error(`${name} is open.`);
      return util.unlink(name);
    },
    async reserve(extraFiles) {
      const needed =
        util.getFileCount() + extraFiles + open.size * TEMPORARY_FILES_PER_DATABASE + SPARE_FILES;
      await util.reserveMinimumCapacity(needed);
    },
  };
  return pool;
}
