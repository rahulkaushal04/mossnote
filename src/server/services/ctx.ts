import { ulid } from 'ulid';
import type { AppConfig } from '../app';
import { AppError } from '../errors';
import type { Clock, Db, Sqlite } from '../db/types';
import type { Journals } from '../journals/types';
import { decodeBase64Url, encodeBase64Url } from './base64url';
import { noStorage, type Storage } from './storage';
import { VocabCache } from './vocab';

/** The open journal's handles, which `Ctx` swaps when another journal is opened. */
export interface Attached {
  db: Db;
  sqlite: Sqlite;
  journal: string;
  dbPath: string;
}

/**
 * Everything a service needs. Tests pass a fake clock and a counting id generator. The journal
 * handles are read each time they are used, so opening another journal re-points every service
 * at once; while no journal is open (a first run) reading them throws.
 */
export interface Ctx {
  readonly db: Db;
  readonly sqlite: Sqlite;
  readonly vocab: VocabCache;
  readonly config: AppConfig;
  /** Where snapshots are kept and what the storage looks like. */
  readonly storage: Storage;
  clock: Clock;
  newId: () => string;
  /** True while a journal is open. */
  readonly attached: boolean;
  attach(journal: Attached): void;
  detach(): void;
  /** Present in the running app; absent in tests that use one fixed in-memory journal. */
  journals: Journals | undefined;
  /** Show the data folder in the system file manager. */
  openFolder: (dir: string) => Promise<void>;
}

export interface CtxInput {
  db?: Db;
  sqlite?: Sqlite;
  clock: Clock;
  config: AppConfig;
  ids?: () => string;
  /** Defaults to {@link noStorage}, for contexts that never touch snapshots. */
  storage?: Storage;
  journals?: Journals;
  openFolder?: (dir: string) => Promise<void>;
}

export function createCtx(input: CtxInput): Ctx {
  let current: Attached | null =
    input.db && input.sqlite
      ? {
          db: input.db,
          sqlite: input.sqlite,
          journal: input.config.journal,
          dbPath: input.config.dbPath,
        }
      : null;
  let vocab = new VocabCache();
  const open = (): Attached => {
    if (!current) throw new AppError('conflict', NO_JOURNAL, { details: { reason: 'no_journal' } });
    return current;
  };
  return {
    get db() {
      return open().db;
    },
    get sqlite() {
      return open().sqlite;
    },
    get vocab() {
      return vocab;
    },
    get config() {
      return current
        ? { ...input.config, journal: current.journal, dbPath: current.dbPath }
        : { ...input.config, journal: '', dbPath: '' };
    },
    storage: input.storage ?? noStorage,
    clock: input.clock,
    newId: input.ids ?? (() => ulid(input.clock.now())),
    get attached() {
      return current !== null;
    },
    attach(journal) {
      current = journal;
      vocab = new VocabCache();
    },
    detach() {
      current = null;
      vocab = new VocabCache();
    },
    journals: input.journals,
    openFolder: input.openFolder ?? (() => Promise.resolve()),
  };
}

export const NO_JOURNAL = 'No journal is open yet. Make one to get started.';

/** Run `fn` in one transaction: it commits together with the search index writes, or not at all. */
export function inTx<T>(ctx: Ctx, fn: () => T): T {
  return ctx.db.transaction(fn);
}

export const iso = (ms: number): string => new Date(ms).toISOString();

/** Opaque cursor: base64url JSON. */
export function encodeCursor(value: unknown): string {
  return encodeBase64Url(JSON.stringify(value));
}

export function decodeCursor<T>(cursor: string, valid: (v: unknown) => v is T): T {
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(cursor));
    if (valid(parsed)) return parsed;
  } catch {
    // Fall through to the error below.
  }
  throw new AppError('validation_failed', 'That cursor is not valid.', {
    fields: { cursor: 'That cursor is not valid.' },
  });
}

/** Offset cursor for the small lists (people, farm entries, backlinks). */
export function offsetFromCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const { offset } = decodeCursor(
    cursor,
    (v): v is { offset: number } =>
      typeof v === 'object' &&
      v !== null &&
      Number.isInteger((v as { offset?: unknown }).offset) &&
      (v as { offset: number }).offset >= 0,
  );
  return offset;
}

export function pageOf<T>(
  rows: T[],
  limit: number,
  offset: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? encodeCursor({ offset: offset + limit }) : null,
  };
}

/** The first item of a list that must not be empty. */
export function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('Expected at least one item.');
  return item;
}
