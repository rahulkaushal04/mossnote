import fs from 'node:fs';
import path from 'node:path';
import { journalOfSnapshotName } from './snapshots';

/** How long a temporary file must have been left alone before it counts as a crash's leftover. */
export const LEFTOVER_MAX_AGE_MS = 3_600_000;

// SQLite's backup also leaves `<partial>-journal` (or `-wal` and `-shm`) when it stops midway.
const PARTIAL_SNAPSHOT = /^(.+\.db)\.partial(-journal|-wal|-shm)?$/;
const STAGED_RESTORE = /^([A-Za-z0-9_-]{1,40})\.db\.restoring$/;
// The name `phone/deviceRegistry.ts` gives its temporary copy: `<file>.<pid>.tmp`.
const DEVICES_TEMP = /^phone-devices\.json\.\d+\.tmp$/;

function safeList(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export interface LeftoverOptions {
  dataDir: string;
  backupsDir: string;
  /** The journal being opened. Its lock is held, so no one else is writing its temporary files. */
  journal: string;
  now: number;
}

/**
 * A snapshot is written as `<name>.db.partial` and a restore is staged as `<journal>.db.restoring`,
 * and the paired devices are saved through `phone-devices.json.<pid>.tmp`. Each is removed by the
 * code that made it, unless the process stopped in between, which leaves a file nothing lists,
 * prunes or counts. Remove those at start-up.
 *
 * Another Mossnote with another journal open may be writing the same kinds of file right now, so a
 * file is removed only when it belongs to the journal being opened (its lock is held, so it can
 * only be a crash's) or has not been written to for an hour. A backup or a copy keeps writing to
 * its file the whole time it runs. Failing to remove anything is not a reason to stop.
 */
export function removeLeftovers(options: LeftoverOptions): number {
  const { dataDir, backupsDir, journal, now } = options;
  let removed = 0;

  const sweep = (dir: string, owner: (name: string) => string | null | undefined) => {
    for (const name of safeList(dir)) {
      const whose = owner(name);
      if (whose === undefined) continue;
      const file = path.join(dir, name);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile()) continue;
        if (whose !== journal && now - stat.mtimeMs < LEFTOVER_MAX_AGE_MS) continue;
        fs.rmSync(file, { force: true });
        removed++;
      } catch {
        // In use, already gone or not ours to remove: leave it for next time.
      }
    }
  };

  // The copies first, then what SQLite left beside them: a copy that stays takes its files with it.
  const snapshotOwner = (name: string, sidecar: boolean) => {
    const match = PARTIAL_SNAPSHOT.exec(name);
    if (match === null || (match[2] !== undefined) !== sidecar) return undefined;
    // A name that is not a snapshot's is not ours; `null` stands for "nobody's journal".
    return journalOfSnapshotName(match[1] ?? '') ?? undefined;
  };
  const copiesBefore = new Set<string>(safeList(backupsDir));
  sweep(backupsDir, (name) => snapshotOwner(name, false));
  sweep(backupsDir, (name) => {
    const owner = snapshotOwner(name, true);
    if (owner === undefined) return undefined;
    const copy = name.replace(/-(journal|wal|shm)$/, '');
    if (fs.existsSync(path.join(backupsDir, copy))) return undefined;
    // Its copy was just removed, so it is a leftover whatever its age; otherwise judge it alone.
    return copiesBefore.has(copy) ? journal : owner;
  });
  sweep(dataDir, (name) => {
    const restore = STAGED_RESTORE.exec(name)?.[1];
    if (restore !== undefined) return restore;
    return DEVICES_TEMP.test(name) ? null : undefined;
  });
  return removed;
}
