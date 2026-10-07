import { ulid } from 'ulid';
import type { AppConfig } from '../app';
import { AppError } from '../errors';
import type { Clock } from '../db/backup';
import type { Db, Sqlite } from '../db/client';
import { VocabCache } from './vocab';

/** Everything a service needs. Tests pass a fake clock and a counting id generator. */
export interface Ctx {
  db: Db;
  sqlite: Sqlite;
  clock: Clock;
  newId: () => string;
  config: AppConfig;
  vocab: VocabCache;
}

export interface CtxInput {
  db: Db;
  sqlite: Sqlite;
  clock: Clock;
  config: AppConfig;
  ids?: () => string;
}

export function createCtx(input: CtxInput): Ctx {
  return {
    db: input.db,
    sqlite: input.sqlite,
    clock: input.clock,
    newId: input.ids ?? (() => ulid(input.clock.now())),
    config: input.config,
    vocab: new VocabCache(),
  };
}

/** Run `fn` in one transaction: it commits together with the search index writes, or not at all. */
export function inTx<T>(ctx: Ctx, fn: () => T): T {
  return ctx.db.transaction(fn);
}

export const iso = (ms: number): string => new Date(ms).toISOString();

/** Opaque cursor: base64url JSON. */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T>(cursor: string, valid: (v: unknown) => v is T): T {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
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
