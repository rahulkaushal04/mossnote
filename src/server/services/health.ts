import type { Sqlite } from '../db/client';

/** Number of applied migrations, which is this build's schema version. 0 when none applied yet. */
export function schemaVersion(sqlite: Sqlite): number {
  const exists = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!exists) return 0;
  return (sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number })
    .n;
}
