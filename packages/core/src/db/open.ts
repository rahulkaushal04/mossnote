import Database from 'better-sqlite3';
import type { Db } from './types.ts';

export interface OpenOptions {
  platform?: string;
  wrapDb?: (d: Db) => Db;
}

/** Durability pragmas. fullfsync on macOS: plain fsync does not flush the drive cache there. */
export function openDb(path: string, opts: OpenOptions = {}): Db {
  const raw = new Database(path);
  try {
    raw.pragma('journal_mode = WAL');
    raw.pragma('synchronous = FULL');
    raw.pragma('foreign_keys = ON');
    raw.pragma('secure_delete = ON');
    raw.pragma('busy_timeout = 2000');
    if ((opts.platform ?? process.platform) === 'darwin') {
      raw.pragma('fullfsync = ON');
      raw.pragma('checkpoint_fullfsync = ON');
    }
  } catch (e) {
    raw.close();
    throw e;
  }
  try {
    return opts.wrapDb ? opts.wrapDb(raw) : raw;
  } catch (e) {
    raw.close();
    throw e;
  }
}
