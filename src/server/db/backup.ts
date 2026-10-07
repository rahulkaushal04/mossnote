import fs from 'node:fs';
import path from 'node:path';
import type { Sqlite } from './client';

export type BackupReason = 'auto' | 'pre-migration' | 'pre-import' | 'manual';

export interface Clock {
  now(): number;
}

export interface Snapshot {
  name: string;
  path: string;
  reason: BackupReason;
  /** Local time encoded in the file name, as epoch milliseconds (minute resolution). */
  takenAt: number;
  size: number;
}

const REASONS: readonly BackupReason[] = ['auto', 'pre-migration', 'pre-import', 'manual'];

/** Snapshots kept per reason (spec section 18). `auto` comes from MOSS_BACKUP_KEEP; manual is never pruned. */
export function retentionFor(reason: BackupReason, autoKeep: number): number | null {
  switch (reason) {
    case 'auto':
      return autoKeep;
    case 'pre-migration':
      return 3;
    case 'pre-import':
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

/** The `-n` between the time and the reason in a snapshot name, or 1 when there is none. */
function sequenceOf(name: string): number {
  const match = /-\d{4}-(\d+)-(?:auto|pre-migration|pre-import|manual)\.db$/.exec(name);
  return match?.[1] ? Number(match[1]) : 1;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** All snapshots for this journal, oldest first. Ignores files that do not match the pattern. */
export function listSnapshots(backupsDir: string, journal: string): Snapshot[] {
  if (!fs.existsSync(backupsDir)) return [];
  const pattern = new RegExp(
    `^${escapeRegExp(journal)}-(\\d{4})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})(?:-(\\d+))?-(${REASONS.join('|')})\\.db$`,
  );
  const found: (Snapshot & { sequence: number })[] = [];
  for (const name of fs.readdirSync(backupsDir)) {
    const m = pattern.exec(name);
    if (!m) continue;
    const [, y, mo, d, h, mi, seq, reason] = m;
    const file = path.join(backupsDir, name);
    found.push({
      name,
      path: file,
      reason: reason as BackupReason,
      takenAt: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)).getTime(),
      size: fs.statSync(file).size,
      sequence: seq ? Number(seq) : 1,
    });
  }
  found.sort((a, b) => a.takenAt - b.takenAt || a.sequence - b.sequence);
  return found.map((s) => ({
    name: s.name,
    path: s.path,
    reason: s.reason,
    takenAt: s.takenAt,
    size: s.size,
  }));
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
  // Within one minute and reason the sequence only ever grows. Taking "the first free number"
  // would reuse a pruned low number, which sorts as the oldest and would be pruned straight away.
  const stamp = new Date(at);
  stamp.setSeconds(0, 0);
  const sameMinute = listSnapshots(backupsDir, journal).filter(
    (snap) => snap.reason === reason && snap.takenAt === stamp.getTime(),
  );
  let sequence = 1;
  for (const snap of sameMinute) sequence = Math.max(sequence, sequenceOf(snap.name) + 1);
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

/** Remove snapshots beyond the retention limit for each reason, oldest first. */
export function pruneSnapshots(backupsDir: string, journal: string, autoKeep: number): string[] {
  const removed: string[] = [];
  const all = listSnapshots(backupsDir, journal);
  for (const reason of REASONS) {
    const keep = retentionFor(reason, autoKeep);
    if (keep === null) continue;
    const mine = all.filter((s) => s.reason === reason);
    for (const old of mine.slice(0, Math.max(0, mine.length - keep))) {
      fs.rmSync(old.path, { force: true });
      removed.push(old.name);
    }
  }
  return removed;
}

export const AUTO_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** True when there is no `auto` snapshot, or the newest one is more than 24 hours old. */
export function autoSnapshotDue(backupsDir: string, journal: string, now: number): boolean {
  const newest = listSnapshots(backupsDir, journal)
    .filter((s) => s.reason === 'auto')
    .at(-1);
  return !newest || now - newest.takenAt > AUTO_SNAPSHOT_INTERVAL_MS;
}

/** Take an `auto` snapshot when one is due. Returns the snapshot, or null when not due. */
export async function snapshotIfDue(
  options: Omit<SnapshotOptions, 'reason'>,
): Promise<Snapshot | null> {
  if (!autoSnapshotDue(options.backupsDir, options.journal, options.clock.now())) return null;
  return createSnapshot({ ...options, reason: 'auto' });
}

/** Result of `PRAGMA integrity_check`: the string "ok" or the list of problems. */
export function integrityCheck(sqlite: Sqlite): string[] {
  const rows = sqlite.pragma('integrity_check') as { integrity_check: string }[];
  const messages = rows.map((r) => r.integrity_check);
  return messages.length === 1 && messages[0] === 'ok' ? [] : messages;
}

/** Newest snapshot of any reason, for the "restore from this" message. */
export function newestSnapshot(backupsDir: string, journal: string): Snapshot | null {
  return listSnapshots(backupsDir, journal).at(-1) ?? null;
}
