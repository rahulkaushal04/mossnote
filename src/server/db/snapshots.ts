import type { Clock, Sqlite } from './types';

/**
 * Snapshots: the rules for naming, keeping and pruning copies of a journal, and the
 * {@link SnapshotStore} that holds them. Pure and portable. Where the copies live is the store's
 * business: `db/backup.ts` keeps them as files in the backups folder, and the browser runtime
 * keeps them inside its storage pool.
 */

export type BackupReason = 'auto' | 'pre-migration' | 'pre-import' | 'pre-restore' | 'manual';

export interface Snapshot {
  name: string;
  /** Where the copy is kept: a file path, or a name inside the browser's storage pool. */
  path: string;
  reason: BackupReason;
  /** Local time encoded in the file name, as epoch milliseconds (minute resolution). */
  takenAt: number;
  size: number;
}

export const BACKUP_REASONS: readonly BackupReason[] = [
  'auto',
  'pre-migration',
  'pre-import',
  'pre-restore',
  'manual',
];

export interface SnapshotRequest {
  sqlite: Sqlite;
  journal: string;
  reason: BackupReason;
  clock: Clock;
  /** Number of `auto` snapshots to keep (MOSS_BACKUP_KEEP). */
  autoKeep: number;
}

/** Holds the snapshots of every journal. */
export interface SnapshotStore {
  /** The journal's snapshots, oldest first. */
  list(journal: string): Snapshot[];
  /** Copy the open database, name the copy, and prune what is beyond the retention limits. */
  create(request: SnapshotRequest): Promise<Snapshot>;
  /** Remove one snapshot. False when this journal has no snapshot with that name. */
  delete(journal: string, name: string): boolean;
}

/** Snapshots kept per reason. `auto` comes from MOSS_BACKUP_KEEP; manual is never pruned. */
export function retentionFor(reason: BackupReason, autoKeep: number): number | null {
  switch (reason) {
    case 'auto':
      return autoKeep;
    case 'pre-migration':
      return 3;
    case 'pre-import':
    case 'pre-restore':
      return 5;
    case 'manual':
      return null;
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `<journal>-YYYYMMDD-HHmm[-n]-<reason>.db` in local time. `n` disambiguates the same minute. */
export function snapshotName(
  journal: string,
  at: number,
  reason: BackupReason,
  sequence = 1,
): string {
  const d = new Date(at);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${journal}-${stamp}${sequence > 1 ? `-${sequence}` : ''}-${reason}.db`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ParsedSnapshotName {
  reason: BackupReason;
  takenAt: number;
  sequence: number;
}

/** Read a snapshot file name back into its parts, or null when it is not this journal's. */
export function parseSnapshotName(journal: string, name: string): ParsedSnapshotName | null {
  const pattern = new RegExp(
    `^${escapeRegExp(journal)}-(\\d{4})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})(?:-(\\d+))?-(${BACKUP_REASONS.join('|')})\\.db$`,
  );
  const match = pattern.exec(name);
  if (!match) return null;
  const [, year, month, day, hour, minute, sequence, reason] = match;
  return {
    reason: reason as BackupReason,
    takenAt: new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
    ).getTime(),
    sequence: sequence ? Number(sequence) : 1,
  };
}

/** The journal a snapshot name belongs to, or null when the name is not a snapshot's. */
export function journalOfSnapshotName(name: string): string | null {
  const pattern = new RegExp(`^(.+)-\\d{8}-\\d{4}(?:-\\d+)?-(?:${BACKUP_REASONS.join('|')})\\.db$`);
  return pattern.exec(name)?.[1] ?? null;
}

/** Oldest first, and by sequence within one minute. */
export function sortSnapshots<T extends { name: string; takenAt: number }>(
  journal: string,
  snapshots: readonly T[],
): T[] {
  const sequenceOf = (name: string) => parseSnapshotName(journal, name)?.sequence ?? 1;
  return [...snapshots].sort(
    (a, b) => a.takenAt - b.takenAt || sequenceOf(a.name) - sequenceOf(b.name),
  );
}

/**
 * The sequence number for a new snapshot of `reason` taken at `at`. Within one minute and reason
 * it only ever grows: taking "the first free number" would reuse a pruned low number, which sorts
 * as the oldest and would be pruned straight away.
 */
export function nextSnapshotSequence(
  journal: string,
  existing: readonly Snapshot[],
  reason: BackupReason,
  at: number,
): number {
  const minute = new Date(at);
  minute.setSeconds(0, 0);
  let sequence = 1;
  for (const snap of existing) {
    if (snap.reason !== reason || snap.takenAt !== minute.getTime()) continue;
    sequence = Math.max(sequence, (parseSnapshotName(journal, snap.name)?.sequence ?? 1) + 1);
  }
  return sequence;
}

/** The snapshots beyond the retention limit for each reason, oldest first. `all` is oldest first. */
export function snapshotsToPrune(all: readonly Snapshot[], autoKeep: number): Snapshot[] {
  const doomed: Snapshot[] = [];
  for (const reason of BACKUP_REASONS) {
    const keep = retentionFor(reason, autoKeep);
    if (keep === null) continue;
    const mine = all.filter((s) => s.reason === reason);
    doomed.push(...mine.slice(0, Math.max(0, mine.length - keep)));
  }
  return doomed;
}

export const AUTO_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** True when there is no `auto` snapshot, or the newest one is more than 24 hours old. */
export function isAutoSnapshotDue(snapshots: readonly Snapshot[], now: number): boolean {
  const newest = snapshots.filter((s) => s.reason === 'auto').at(-1);
  return !newest || now - newest.takenAt > AUTO_SNAPSHOT_INTERVAL_MS;
}

/** Take an `auto` snapshot when one is due. Returns the snapshot, or null when not due. */
export async function snapshotWhenDue(
  store: SnapshotStore,
  request: Omit<SnapshotRequest, 'reason'>,
): Promise<Snapshot | null> {
  if (!isAutoSnapshotDue(store.list(request.journal), request.clock.now())) return null;
  return store.create({ ...request, reason: 'auto' });
}

/** Result of `PRAGMA integrity_check`: an empty list when the database is sound. */
export function integrityCheck(sqlite: Sqlite): string[] {
  const rows = sqlite.pragma('integrity_check') as { integrity_check: string }[];
  const messages = rows.map((r) => r.integrity_check);
  return messages.length === 1 && messages[0] === 'ok' ? [] : messages;
}
