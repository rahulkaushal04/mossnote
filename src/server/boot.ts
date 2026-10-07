import { ConfigError, type Config } from './config';
import { ensureDataDir } from './dataDir';
import {
  integrityCheck,
  newestSnapshot,
  snapshotIfDue,
  type Clock,
  type Snapshot,
} from './db/backup';
import { openDatabase, type Database } from './db/client';
import {
  MigrationFailedError,
  migrateDatabase,
  NewerJournalError,
  type MigrateResult,
} from './db/migrate';
import { acquireLock, AlreadyRunningError, type Lock } from './lock';
import type { Logger } from './logger';
import { ensureSettings } from './services/settings';
import { purgeOldTrash } from './services/trash';

const CORRUPTION_CODES = new Set(['SQLITE_CORRUPT', 'SQLITE_NOTADB', 'SQLITE_CORRUPT_VTAB']);

/** SQLite reports a damaged file either from `integrity_check` or as an error while opening it. */
function isCorruption(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CORRUPTION_CODES.has(code);
}

/** `PRAGMA integrity_check` failed. The server refuses to start. */
export class IntegrityError extends Error {
  readonly problems: string[];
  readonly newest: Snapshot | null;
  constructor(problems: string[], newest: Snapshot | null) {
    super('The journal failed its integrity check.');
    this.problems = problems;
    this.newest = newest;
  }
}

export interface Journal {
  database: Database;
  migration: MigrateResult;
  /** The automatic snapshot taken by this start, if one was due. */
  snapshot: Snapshot | null;
  /** Close the database and release the lock file. Safe to call twice. */
  close(): void;
}

export interface OpenJournalOptions {
  config: Config;
  clock: Clock;
  logger: Logger;
  migrationsFolder: string;
  /** Process id written to the lock file. Tests pass a different one to simulate a second process. */
  pid?: number;
}

/**
 * The startup sequence: create the data folder, take the lock, open the
 * database, check integrity, migrate (with a pre-migration snapshot for existing journals),
 * create the default settings rows, and take the daily automatic snapshot when due.
 */
export async function openJournal(options: OpenJournalOptions): Promise<Journal> {
  const { config, clock, logger, migrationsFolder } = options;

  ensureDataDir(config);
  const lock: Lock = acquireLock(config.lockPath, options.pid);
  let database: Database | undefined;
  try {
    let problems: string[];
    try {
      database = openDatabase(config.dbPath);
      problems = integrityCheck(database.sqlite);
    } catch (error) {
      if (!isCorruption(error)) throw error;
      problems = [(error as Error).message];
    }
    if (problems.length > 0) {
      throw new IntegrityError(problems, newestSnapshot(config.backupsDir, config.journal));
    }

    if (!database) throw new Error('The database did not open.');
    const migration = await migrateDatabase({
      database,
      migrationsFolder,
      backupsDir: config.backupsDir,
      journal: config.journal,
      clock,
      autoKeep: config.backupKeep,
    });
    if (migration.applied > 0) logger.info('applied migrations', { count: migration.applied });

    ensureSettings(database, config.journal, clock);

    // Records deleted more than 30 days ago are removed for good.
    const purged = purgeOldTrash({ sqlite: database.sqlite, clock });
    if (purged > 0) logger.info('purged old deleted records', { count: purged });

    const snapshot = await snapshotIfDue({
      sqlite: database.sqlite,
      backupsDir: config.backupsDir,
      journal: config.journal,
      clock,
      autoKeep: config.backupKeep,
    });
    if (snapshot) logger.info('took automatic snapshot', { name: snapshot.name });

    const opened = database;
    let closed = false;
    return {
      database: opened,
      migration,
      snapshot,
      close() {
        if (closed) return;
        closed = true;
        opened.sqlite.close();
        lock.release();
      },
    };
  } catch (error) {
    database?.sqlite.close();
    lock.release();
    throw error;
  }
}

/** Terminal text for a startup failure. Lines are printed in order. */
export function describeStartupError(error: unknown, config: Config): string[] {
  const url = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
  if (error instanceof ConfigError) return [error.message];
  if (error instanceof AlreadyRunningError) {
    return [`Mossnote is already running (PID ${error.pid}) at ${url}.`];
  }
  if (error instanceof NewerJournalError) return [error.message];
  if (error instanceof MigrationFailedError) {
    return [
      error.message,
      error.snapshotPath
        ? `Your journal is unchanged. A snapshot from just before the migration is at ${error.snapshotPath}.`
        : 'Your journal is unchanged.',
    ];
  }
  if (error instanceof IntegrityError) {
    const lines = ['The journal failed its integrity check, so Mossnote will not start.'];
    if (error.newest) {
      lines.push(
        `The newest snapshot is ${error.newest.path}.`,
        'To restore it: stop Mossnote, copy that file over',
        `  ${config.dbPath}`,
        `delete ${config.dbPath}-wal and ${config.dbPath}-shm, then start Mossnote again.`,
      );
    } else {
      lines.push(`There are no snapshots in ${config.backupsDir}.`);
    }
    return lines;
  }
  if ((error as NodeJS.ErrnoException | null)?.code === 'EADDRINUSE') {
    return [`Port ${config.port} is already in use. Set MOSS_PORT to use a different port.`];
  }
  return [`Mossnote could not start: ${error instanceof Error ? error.message : String(error)}`];
}
