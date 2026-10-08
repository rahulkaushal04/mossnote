import type { Sqlite } from '@server/db/types';

/**
 * The database files of the browser runtime: journals, snapshots and the small catalog. A pool
 * hides where they live. In the browser that is the origin private file system
 * (`sahPool.ts`); in tests it is memory (`memoryPool.ts`).
 *
 * Names are absolute paths such as `/journals/example.db`. Everything here is synchronous except
 * making room for new files, which the browser only allows asynchronously.
 */
export interface FilePool {
  /** Every database file, without the temporary files SQLite keeps beside open ones. */
  names(): string[];
  has(name: string): boolean;
  /**
   * Open a database file, creating it when missing. A file can have one open connection at a
   * time; the caller closes it before opening it again.
   */
  open(name: string): Sqlite;
  /** The file's contents. For an open database, a consistent copy of it as it is now. */
  read(name: string): Uint8Array;
  /** Create or replace a database file. It must not be open. */
  write(name: string, bytes: Uint8Array): Promise<void>;
  /** Delete a file. False when there is none. It must not be open. */
  remove(name: string): boolean;
  /** Make room for `extraFiles` more files. Call before creating files. */
  reserve(extraFiles: number): Promise<void>;
}
