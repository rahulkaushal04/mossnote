import fs from 'node:fs';
import type { BackupInfo, DataInfo } from '@shared/types';
import { createSnapshot, deleteSnapshot, listSnapshots, type Snapshot } from '../db/backup';
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
  return listSnapshots(ctx.config.backupsDir, ctx.config.journal).map(toInfo).reverse();
}

/** `POST /api/data/backup`: a manual snapshot, never pruned automatically. */
export async function backupNow(ctx: Ctx): Promise<BackupInfo> {
  const snapshot = await createSnapshot({
    sqlite: ctx.sqlite,
    backupsDir: ctx.config.backupsDir,
    journal: ctx.config.journal,
    reason: 'manual',
    clock: ctx.clock,
    autoKeep: ctx.config.backupKeep,
  });
  return toInfo(snapshot);
}

/** Remove one snapshot of the open journal (`DELETE /api/data/backups/:name`). */
export function deleteBackup(ctx: Ctx, name: string): void {
  if (!deleteSnapshot(ctx.config.backupsDir, ctx.config.journal, name)) {
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
  let bytes = 0;
  try {
    bytes = fs.statSync(ctx.config.dbPath).size;
  } catch {
    // In-memory databases (tests) have no file.
  }
  const snapshots = listSnapshots(ctx.config.backupsDir, ctx.config.journal);
  const newest = snapshots.at(-1);
  return {
    dataDir: ctx.config.dataDir,
    backupsDir: ctx.config.backupsDir,
    databasePath: ctx.config.dbPath,
    databaseBytes: bytes,
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
