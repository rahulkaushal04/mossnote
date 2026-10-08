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
import { isCorruption } from './db/corruption';
import { knownMigrations, peekSchema } from './db/catalog';
import {
  MigrationFailedError,
  migrateDatabase,
  NewerJournalError,
  type MigrateResult,
} from './db/migrate';
import { acquireLock, AlreadyRunningError, type Lock } from './lock';
import type { Logger } from './logger';
import { createCtx } from './services/ctx';
import { reindexAll } from './services/search-index';
import { ensureSettings } from './services/settings';
import { purgeOldTrash } from './services/trash';

/** `PRAGMA integrity_check` failed. The server refuses to start. */
export class IntegrityError extends Error {
  readonly problems: string[];
  readonly newest: Snapshot | null;
  /** The journal file that failed, for the restore steps. */
  readonly dbPath: string;
  constructor(problems: string[], newest: Snapshot | null, dbPath: string) {
    super('The journal failed its integrity check.');
    this.problems = problems;
    this.newest = newest;
    this.dbPath = dbPath;
  }
}

/** The schema state of a journal file, or null when the file cannot even be read as a database. */
function peekSafely(dbPath: string, migrationsFolder: string) {
  try {
    return peekSchema(dbPath, knownMigrations(migrationsFolder));
  } catch {
    return null;
  }
}

export interface Journal {
  /** The journal's id, which is its file name stem. */
  id: string;
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
  /** Name and template for a journal that does not exist yet. Ignored for an existing one. */
  init?: { name: string; template: string };
}

/**
 * The startup sequence: create the data folder, refuse a journal from a newer version, take the
 * lock, open the database, check integrity, migrate (with a pre-migration snapshot for existing
 * journals), create the default settings rows, and take the daily automatic snapshot when due.
 */
export async function openJournal(options: OpenJournalOptions): Promise<Journal> {
  const { config, clock, logger, migrationsFolder } = options;

  ensureDataDir(config);
  // Looked at before anything can write: a newer journal is left exactly as it is.
  if (peekSafely(config.dbPath, migrationsFolder) === 'newer') throw new NewerJournalError();
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
      throw new IntegrityError(
        problems,
        newestSnapshot(config.backupsDir, config.journal),
        config.dbPath,
      );
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
    if (migration.applied > 0) {
      logger.info('applied migrations', { count: migration.applied });
      // A journal from before the search index existed has records the index does not know yet.
      reindexAll(createCtx({ db: database.db, sqlite: database.sqlite, clock, config }));
    }

    ensureSettings(database, options.init?.name ?? config.journal, clock, options.init?.template);

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
      id: config.journal,
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
        `  ${error.dbPath}`,
        `delete ${error.dbPath}-wal and ${error.dbPath}-shm, then start Mossnote again.`,
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
