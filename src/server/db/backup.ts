import fs from 'node:fs';
import path from 'node:path';
import {
  isAutoSnapshotDue,
  nextSnapshotSequence,
  parseSnapshotName,
  snapshotName,
  snapshotsToPrune,
  sortSnapshots,
  type BackupReason,
  type Snapshot,
  type SnapshotRequest,
  type SnapshotStore,
} from './snapshots';
import type { Clock, Sqlite } from './types';

/**
 * Snapshots as files in the backups folder: the Node server's {@link SnapshotStore}. The naming,
 * retention and "is one due" rules are in `snapshots.ts`.
 */

export {
  AUTO_SNAPSHOT_INTERVAL_MS,
  integrityCheck,
  retentionFor,
  snapshotName,
  type BackupReason,
  type Snapshot,
} from './snapshots';
export type { Clock } from './types';

/** All snapshots for this journal, oldest first. Ignores files that do not match the pattern. */
export function listSnapshots(backupsDir: string, journal: string): Snapshot[] {
  if (!fs.existsSync(backupsDir)) return [];
  const found: Snapshot[] = [];
  for (const name of fs.readdirSync(backupsDir)) {
    const parsed = parseSnapshotName(journal, name);
    if (!parsed) continue;
    const file = path.join(backupsDir, name);
    found.push({
      name,
      path: file,
      reason: parsed.reason,
      takenAt: parsed.takenAt,
      size: fs.statSync(file).size,
    });
  }
  return sortSnapshots(journal, found);
}

export interface SnapshotOptions {
  sqlite: Sqlite;
  backupsDir: string;
  journal: string;
  reason: BackupReason;
  clock: Clock;
  /** Number of `auto` snapshots to keep (MOSS_BACKUP_KEEP). */
  autoKeep: number;
}

/**
 * Take a snapshot with SQLite's online backup API, which is safe while the database is open in
 * WAL mode (copying the .db file alone is not a valid backup), then prune by retention.
 */
export async function createSnapshot(options: SnapshotOptions): Promise<Snapshot> {
  const { sqlite, backupsDir, journal, reason, clock, autoKeep } = options;
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });

  const at = clock.now();
  const sequence = nextSnapshotSequence(journal, listSnapshots(backupsDir, journal), reason, at);
  const name = snapshotName(journal, at, reason, sequence);
  const target = path.join(backupsDir, name);
  const partial = `${target}.partial`;

  try {
    await sqlite.backup(partial);
    fs.renameSync(partial, target);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    // Platforms without POSIX modes.
  }

  pruneSnapshots(backupsDir, journal, autoKeep);
  const made = listSnapshots(backupsDir, journal).find((s) => s.name === name);
  if (!made) throw new Error(`Snapshot ${name} was created but could not be listed.`);
  return made;
}

/** Remove one snapshot file. Returns false when this journal has no snapshot with that name. */
export function deleteSnapshot(backupsDir: string, journal: string, name: string): boolean {
  const snapshot = listSnapshots(backupsDir, journal).find((s) => s.name === name);
  if (!snapshot) return false;
  fs.rmSync(snapshot.path, { force: true });
  return true;
}

/** Remove snapshots beyond the retention limit for each reason, oldest first. */
export function pruneSnapshots(backupsDir: string, journal: string, autoKeep: number): string[] {
  const doomed = snapshotsToPrune(listSnapshots(backupsDir, journal), autoKeep);
  for (const old of doomed) fs.rmSync(old.path, { force: true });
  return doomed.map((s) => s.name);
}

/** True when there is no `auto` snapshot, or the newest one is more than 24 hours old. */
export function autoSnapshotDue(backupsDir: string, journal: string, now: number): boolean {
  return isAutoSnapshotDue(listSnapshots(backupsDir, journal), now);
}

/** Take an `auto` snapshot when one is due. Returns the snapshot, or null when not due. */
export async function snapshotIfDue(
  options: Omit<SnapshotOptions, 'reason'>,
): Promise<Snapshot | null> {
  if (!autoSnapshotDue(options.backupsDir, options.journal, options.clock.now())) return null;
  return createSnapshot({ ...options, reason: 'auto' });
}

/** Newest snapshot of any reason, for the "restore from this" message. */
export function newestSnapshot(backupsDir: string, journal: string): Snapshot | null {
  return listSnapshots(backupsDir, journal).at(-1) ?? null;
}

/** The backups folder as a {@link SnapshotStore}. */
export function createFileSnapshotStore(backupsDir: string): SnapshotStore {
  return {
    list: (journal) => listSnapshots(backupsDir, journal),
    create: (request: SnapshotRequest) =>
      createSnapshot({
        sqlite: request.sqlite,
        backupsDir,
        journal: request.journal,
        reason: request.reason,
        clock: request.clock,
        autoKeep: request.autoKeep,
      }),
    delete: (journal, name) => deleteSnapshot(backupsDir, journal, name),
  };
}
