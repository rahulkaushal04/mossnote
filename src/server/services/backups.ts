import type { BackupInfo, DataInfo } from '@shared/types';
import type { Snapshot } from '../db/snapshots';
import { notFound } from '../errors';
import { iso, type Ctx } from './ctx';

const toInfo = (s: Snapshot): BackupInfo => ({
  name: s.name,
  reason: s.reason,
  size: s.size,
  takenAt: iso(s.takenAt),
});

/** Newest first. */
export function listBackups(ctx: Ctx): BackupInfo[] {
  return ctx.storage.snapshots.list(ctx.config.journal).map(toInfo).reverse();
}

/** `POST /api/data/backup`: a manual snapshot, never pruned automatically. */
export async function backupNow(ctx: Ctx): Promise<BackupInfo> {
  const snapshot = await ctx.storage.snapshots.create({
    sqlite: ctx.sqlite,
    journal: ctx.config.journal,
    reason: 'manual',
    clock: ctx.clock,
    autoKeep: ctx.config.backupKeep,
  });
  return toInfo(snapshot);
}

/** Remove one snapshot of the open journal (`DELETE /api/data/backups/:name`). */
export function deleteBackup(ctx: Ctx, name: string): void {
  if (!ctx.storage.snapshots.delete(ctx.config.journal, name)) {
    throw notFound("That snapshot doesn't exist.");
  }
}

const COUNTS = `
  SELECT (SELECT count(*) FROM notes WHERE deleted_at IS NULL) AS notes,
         (SELECT count(*) FROM people WHERE deleted_at IS NULL) AS people,
         (SELECT count(*) FROM plantings WHERE deleted_at IS NULL) AS plantings,
         (SELECT count(*) FROM tags) AS tags,
         (SELECT count(*) FROM maps WHERE deleted_at IS NULL) AS maps`;

/** Storage facts for Settings → Data & backup. */
export function dataInfo(ctx: Ctx): DataInfo {
  const counts = ctx.sqlite.prepare(COUNTS).get() as DataInfo['counts'];
  const { location, databaseBytes } = ctx.storage.describe(ctx.config.journal);
  const snapshots = ctx.storage.snapshots.list(ctx.config.journal);
  const newest = snapshots.at(-1);
  return {
    location,
    databaseBytes,
    journal: {
      id: ctx.config.journal,
      name: ctx.journals?.get(ctx.config.journal).name ?? ctx.config.journal,
    },
    counts,
    lastBackupAt: newest ? iso(newest.takenAt) : null,
    backupCount: snapshots.length,
    backupBytes: snapshots.reduce((sum, s) => sum + s.size, 0),
  };
}
