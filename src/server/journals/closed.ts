import { knownMigrations, peekSchema } from '../db/catalog';
import { openDatabase, openDatabaseReadOnly, type Database, type Sqlite } from '../db/client';
import { NEWER_JOURNAL_MESSAGE } from '../db/migrate';
import { conflict } from '../errors';
import { AlreadyRunningError, acquireLock, type Lock } from '../lock';
import { createCtx, type Ctx } from '../services/ctx';
import type { Config } from '../config';
import type { Clock } from '../db/backup';
import { journalPaths } from './paths';

/**
 * Looking at journals that are not the open one: renaming, taking a last snapshot, deleting,
 * exporting. Each holds the journal's lock for as long as it needs it, so another copy of Mossnote
 * cannot be using the file, and none of it ever migrates or changes a schema.
 */
export interface ClosedEnv {
  config: Config;
  clock: Clock;
  migrationsFolder: string;
  pid?: number | undefined;
}

/** `needs_newer_app` for the web app: a journal that a newer build made. */
export const newerApp = () => conflict(NEWER_JOURNAL_MESSAGE, { reason: 'needs_newer_app' });

/** Take a journal's lock, or say plainly that another copy of Mossnote has it open. */
export function lockOrExplain(lockPath: string, pid: number | undefined): Lock {
  try {
    return acquireLock(lockPath, pid);
  } catch (error) {
    if (error instanceof AlreadyRunningError) {
      throw conflict('That journal is open in another copy of Mossnote. Close that one first.', {
        reason: 'in_use',
      });
    }
    throw error;
  }
}

/** Run `use` on a journal that is not open, holding its lock. Refuses a journal from a newer build. */
export function withClosedJournal<T>(
  env: ClosedEnv,
  id: string,
  use: (database: Database) => T,
): T {
  const paths = journalPaths(env.config.dataDir, id);
  if (peekSchema(paths.dbPath, knownMigrations(env.migrationsFolder)) === 'newer') {
    throw newerApp();
  }
  const lock = lockOrExplain(paths.lockPath, env.pid);
  const database = openDatabase(paths.dbPath);
  try {
    return use(database);
  } finally {
    database.sqlite.close();
    lock.release();
  }
}

/**
 * A locked handle on a journal that is not open, for taking a snapshot or checking that nothing
 * else has it before its files go. A journal from a newer build is opened read-only: it can be
 * copied and deleted, never written to.
 */
export function lockedHandle(env: ClosedEnv, id: string): { sqlite: Sqlite; release: () => void } {
  const paths = journalPaths(env.config.dataDir, id);
  const newer = peekSchema(paths.dbPath, knownMigrations(env.migrationsFolder)) === 'newer';
  const lock = lockOrExplain(paths.lockPath, env.pid);
  const database = newer ? openDatabaseReadOnly(paths.dbPath) : openDatabase(paths.dbPath);
  return {
    sqlite: database.sqlite,
    release: () => {
      database.sqlite.close();
      lock.release();
    },
  };
}

/**
 * Run `build` against a journal that is not open, to export it. Only a journal already at this
 * build's schema is read; one from an older version is brought up to date by opening it, not by
 * exporting it.
 */
export function readClosedJournal<T>(env: ClosedEnv, id: string, build: (ctx: Ctx) => T): T {
  const paths = journalPaths(env.config.dataDir, id);
  const state = peekSchema(paths.dbPath, knownMigrations(env.migrationsFolder));
  if (state === 'newer') throw newerApp();
  if (state !== 'current') {
    throw conflict('Open that journal once so Mossnote can bring it up to date, then export it.', {
      reason: 'needs_upgrade',
    });
  }
  const lock = lockOrExplain(paths.lockPath, env.pid);
  const database = openDatabaseReadOnly(paths.dbPath);
  try {
    const ctx = createCtx({
      db: database.db,
      sqlite: database.sqlite,
      clock: env.clock,
      config: { ...env.config, ...paths },
    });
    return build(ctx);
  } finally {
    database.sqlite.close();
    lock.release();
  }
}
