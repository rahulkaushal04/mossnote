import fs from 'node:fs';
import type { BackupInfo, DataInfo } from '@shared/types';
import { createSnapshot, listSnapshots, type Snapshot } from '../db/backup';
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
  const newest = listSnapshots(ctx.config.backupsDir, ctx.config.journal).at(-1);
  return {
    dataDir: ctx.config.dataDir,
    databasePath: ctx.config.dbPath,
    databaseBytes: bytes,
    counts,
    lastBackupAt: newest ? iso(newest.takenAt) : null,
  };
}
