import fs from 'node:fs';
import type { BackupInfo } from '@shared/types';
import type { Config } from '../config';
import { createSnapshot, integrityCheck, listSnapshots, type Clock } from '../db/backup';
import { knownMigrations, peekSchema } from '../db/catalog';
import { openDatabaseReadOnly } from '../db/client';
import { AppError, conflict, notFound } from '../errors';
import { iso } from '../services/ctx';
import { newerApp } from './closed';
import { journalPaths } from './paths';

/** What restoring a snapshot needs from the manager, which owns the open journal. */
export interface RestoreEnv {
  config: Config;
  clock: Clock;
  migrationsFolder: string;
  /** The open journal, whose snapshots are listed and which is replaced. */
  journal: { id: string; sqlite: Parameters<typeof createSnapshot>[0]['sqlite'] };
  /** Close the open journal (keeping nothing open) so its file can be replaced. */
  release: () => void;
  /** Open the journal again from its file and make it the open one. */
  reopen: () => Promise<void>;
}

const toInfo = (s: {
  name: string;
  reason: BackupInfo['reason'];
  size: number;
  takenAt: number;
}): BackupInfo => ({ name: s.name, reason: s.reason, size: s.size, takenAt: iso(s.takenAt) });

/** True when the snapshot opens and passes `integrity_check`; refuses one from a newer build. */
function isRestorable(path: string, migrationsFolder: string): boolean {
  try {
    if (peekSchema(path, knownMigrations(migrationsFolder)) === 'newer') throw newerApp();
    const probe = openDatabaseReadOnly(path);
    try {
      return integrityCheck(probe.sqlite).length === 0;
    } finally {
      probe.sqlite.close();
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    return false;
  }
}

/**
 * Put a snapshot back as the open journal. The snapshot is checked first, the journal as it is
 * now is saved as a `pre-restore` snapshot, and only then is the file replaced. A snapshot from
 * an older version is migrated forward as usual when the journal reopens; if reopening fails the
 * journal is put back as it was.
 */
export async function restoreSnapshot(
  env: RestoreEnv,
  name: string,
): Promise<{ restored: BackupInfo; safety: BackupInfo }> {
  const { config, journal } = env;
  const snapshot = listSnapshots(config.backupsDir, journal.id).find((s) => s.name === name);
  if (!snapshot) throw notFound("That snapshot doesn't exist.");
  if (!isRestorable(snapshot.path, env.migrationsFolder)) {
    throw conflict("That snapshot is damaged, so it can't be restored. Nothing was changed.", {
      reason: 'damaged',
    });
  }

  const safety = await createSnapshot({
    sqlite: journal.sqlite,
    backupsDir: config.backupsDir,
    journal: journal.id,
    reason: 'pre-restore',
    clock: env.clock,
    autoKeep: config.backupKeep,
  });

  const { dbPath } = journalPaths(config.dataDir, journal.id);
  const replaceWith = (source: string) => {
    const staged = `${dbPath}.restoring`;
    fs.copyFileSync(source, staged);
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
    fs.renameSync(staged, dbPath);
  };

  env.release();
  try {
    replaceWith(snapshot.path);
    await env.reopen();
  } catch (error) {
    replaceWith(safety.path);
    await env.reopen();
    throw error instanceof AppError
      ? error
      : conflict("That snapshot couldn't be restored. Your journal is as it was.", {
          reason: 'restore_failed',
        });
  }
  return { restored: toInfo(snapshot), safety: toInfo(safety) };
}
