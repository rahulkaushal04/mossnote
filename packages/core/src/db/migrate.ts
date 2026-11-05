import { basename, dirname, join } from 'node:path';
import type { Migration } from '../../migrations/types.ts';
import { err, ok, type Result } from '../result.ts';
import { toAppError } from './errors.ts';
import type { FsPort } from './fs.ts';
import { createTxRunner } from './tx.ts';
import type { Db } from './types.ts';

export interface MigrateResult {
  from: number;
  to: number;
  backupPath: string | null;
}

export const userVersion = (db: Db): number =>
  db.pragma('user_version', { simple: true }) as number;

/** Forward-only. All pending migrations run in ONE transaction, so a failure in any of them
 *  leaves the file as it was (CS-2). A verified backup (tmp + fsync + rename) precedes any change. */
export function migrate(
  db: Db,
  fs: FsPort,
  dbPath: string,
  migrations: readonly Migration[],
  backupDir: string,
  backupId: () => string,
): Result<MigrateResult> {
  if (migrations.some((m, i) => m.version !== i + 1))
    return err('internal', 'migrations must be contiguous from 1');
  const latest = migrations.length;
  try {
    const from = userVersion(db);
    if (from > latest) return err('unavailable', 'This workspace was created by a newer Mossnote');
    if (from === latest) return ok({ from, to: from, backupPath: null });

    let backupPath: string | null = null;
    if (from > 0) {
      // Fold the WAL into the main file so the copy is complete; refuse to copy a partial checkpoint.
      const cp = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
      if (cp[0]?.busy) return err('unavailable', 'workspace in use (checkpoint busy)');
      backupPath = join(backupDir, `pre-migration-v${from}-${backupId()}.sqlite`);
      const tmp = `${backupPath}.tmp`;
      try {
        fs.mkdirp(backupDir);
        fs.copyFile(dbPath, tmp);
        fs.fsyncPath(tmp);
        fs.rename(tmp, backupPath);
        fs.fsyncPath(dirname(backupPath));
      } catch (e) {
        if (fs.exists(tmp)) fs.unlink(tmp);
        const r = toAppError(e);
        return err(
          r.ok ? 'io' : r.error.code,
          `Pre-migration backup failed: ${basename(dbPath)}`,
          e,
        );
      }
    }

    const run = createTxRunner(db);
    db.pragma('foreign_keys = OFF'); // lets future table-rebuild migrations work; checked below
    try {
      const r = run(() => {
        for (const m of migrations.slice(from)) db.exec(m.sql);
        const bad = db.pragma('foreign_key_check') as unknown[];
        if (bad.length) return err('internal', 'migration left foreign key violations');
        db.exec(`PRAGMA user_version = ${latest}`);
        return ok(undefined);
      });
      if (!r.ok) return r;
    } finally {
      db.pragma('foreign_keys = ON');
    }
    return ok({ from, to: latest, backupPath });
  } catch (e) {
    return toAppError(e);
  }
}

/** Normalized schema for comparing fresh vs upgraded databases (CS-1). */
export function schemaDump(db: Db): string {
  const rows = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all() as { type: string; name: string; sql: string }[];
  return (
    rows.map((r) => `${r.type} ${r.name}: ${r.sql.replace(/\s+/g, ' ').trim()}`).join('\n') +
    `\nuser_version=${userVersion(db)}`
  );
}
