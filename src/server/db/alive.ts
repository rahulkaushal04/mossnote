import { isNull, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * The one place that decides what "not soft-deleted" means. Every read of a
 * table with a `deletedAt` column goes through it: `.where(alive(notes))`.
 */
export function alive(table: { deletedAt: SQLiteColumn }): SQL {
  return isNull(table.deletedAt);
}
