import type {
  Database as WasmDatabase,
  PreparedStatement,
  Sqlite3Static,
  SqlValue,
} from '@sqlite.org/sqlite-wasm';
import type { RunResult, Sqlite, Statement, Transaction } from '@server/db/types';

/**
 * A `Sqlite` connection over SQLite compiled to WebAssembly. It behaves like `better-sqlite3`
 * for the part of that API this app uses, so the services and Drizzle run on it unchanged.
 *
 * What it takes care of that the WebAssembly API does not:
 *  - statements are cached by their SQL, because Drizzle prepares a statement for every query
 *    and nothing would ever free them;
 *  - transactions nest (a savepoint inside an open transaction), as `better-sqlite3` does;
 *  - errors carry `code` ("SQLITE_CONSTRAINT_UNIQUE", ...) as `better-sqlite3` errors do.
 */

export type Sqlite3 = Sqlite3Static;

/** Compiled statements kept per connection. The app uses a few dozen distinct statements. */
const STATEMENT_CACHE_SIZE = 200;

export interface ConnectionHooks {
  /** Write a consistent copy of this database to `destination` (see `Sqlite.backup`). */
  backup(destination: string): Promise<void>;
  /** Called once, just before the connection closes, while the database can still be read. */
  beforeClose?(): void;
}

type Row = Record<string, SqlValue>;
type Rows = (Row | SqlValue[])[];

function toBindable(value: unknown): SqlValue {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'bigint':
      return value;
    case 'object':
      if (value instanceof Uint8Array) return value;
  }
  throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null');
}

/** Positional parameters, as `better-sqlite3` takes them: values, or one array of values. */
function toBindings(params: readonly unknown[]): SqlValue[] {
  const [only] = params;
  const flat: readonly unknown[] = params.length === 1 && Array.isArray(only) ? only : params;
  return flat.map(toBindable);
}

/** SQLite's 64-bit integers as plain numbers when that loses nothing, as `better-sqlite3` does. */
function asNumberIfSafe(value: bigint | number): bigint | number {
  return typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value;
}

/** Bind the parameters. A statement without any refuses even an empty list, so skip it then. */
function bindAll(stmt: PreparedStatement, params: readonly unknown[]): void {
  const bindings = toBindings(params);
  if (bindings.length > 0) stmt.bind(bindings);
}

export function createConnection(
  sqlite3: Sqlite3,
  db: WasmDatabase,
  hooks: ConnectionHooks,
): Sqlite {
  const { capi } = sqlite3;
  const cache = new Map<string, PreparedStatement>();
  let depth = 0;

  const withCode = (error: unknown): never => {
    if (error instanceof sqlite3.SQLite3Error) {
      Object.assign(error, { code: capi.sqlite3_js_rc_str(error.resultCode) });
    }
    throw error;
  };
  const guard = <T>(work: () => T): T => {
    try {
      return work();
    } catch (error) {
      return withCode(error);
    }
  };

  const compiled = (sql: string): PreparedStatement => {
    const hit = cache.get(sql);
    if (hit) {
      // Re-insert so the least recently used statement is the first key.
      cache.delete(sql);
      cache.set(sql, hit);
      return hit;
    }
    const fresh = db.prepare(sql);
    cache.set(sql, fresh);
    if (cache.size > STATEMENT_CACHE_SIZE) {
      const [oldest] = cache.keys();
      if (oldest !== undefined) {
        cache.get(oldest)?.finalize();
        cache.delete(oldest);
      }
    }
    return fresh;
  };

  const readAll = (sql: string, params: readonly unknown[], asArrays: boolean): Rows => {
    const stmt = compiled(sql);
    try {
      bindAll(stmt, params);
      const rows: Rows = [];
      while (stmt.step()) rows.push(asArrays ? stmt.get([]) : stmt.get({}));
      return rows;
    } finally {
      stmt.reset(true);
    }
  };

  const statement = (sql: string): Statement => {
    guard(() => compiled(sql));
    let asArrays = false;
    const self: Statement = {
      run(...params): RunResult {
        return guard(() => {
          const stmt = compiled(sql);
          try {
            bindAll(stmt, params);
            while (stmt.step()) {
              // A statement that returns rows is run to the end, as `better-sqlite3` does.
            }
          } finally {
            stmt.reset(true);
          }
          return {
            changes: db.changes(),
            lastInsertRowid: asNumberIfSafe(capi.sqlite3_last_insert_rowid(db)),
          };
        });
      },
      get: (...params) => guard(() => readAll(sql, params, asArrays)[0]),
      all: (...params) => guard(() => readAll(sql, params, asArrays)),
      raw(toggle = true) {
        asArrays = toggle;
        return self;
      },
    };
    return self;
  };

  const inTransaction = () => capi.sqlite3_get_autocommit(db) === 0;

  const run = <Args extends unknown[], Result>(
    mode: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE',
    work: (...args: Args) => Result,
    args: Args,
  ): Result => {
    const nested = inTransaction();
    const savepoint = `moss_sp_${depth}`;
    const begin = nested ? `SAVEPOINT ${savepoint}` : `BEGIN ${mode}`;
    const commit = nested ? `RELEASE ${savepoint}` : 'COMMIT';
    const rollback = nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK';
    guard(() => db.exec(begin));
    depth++;
    try {
      const result = work(...args);
      guard(() => db.exec(commit));
      return result;
    } catch (error) {
      if (inTransaction()) guard(() => db.exec(rollback));
      return withCode(error);
    } finally {
      depth--;
    }
  };

  return {
    prepare: statement,
    exec(sql) {
      guard(() => db.exec(sql));
    },
    pragma(source, options) {
      const rows = guard(() =>
        db.exec({ sql: `PRAGMA ${source}`, rowMode: 'object', returnValue: 'resultRows' }),
      );
      if (!options?.simple) return rows;
      const [first] = rows;
      return first ? Object.values(first)[0] : undefined;
    },
    transaction<Args extends unknown[], Result>(
      work: (...args: Args) => Result,
    ): Transaction<Args, Result> {
      const call = (...args: Args) => run('DEFERRED', work, args);
      return Object.assign(call, {
        deferred: call,
        immediate: (...args: Args) => run('IMMEDIATE', work, args),
        exclusive: (...args: Args) => run('EXCLUSIVE', work, args),
      });
    },
    backup: (destination) => hooks.backup(destination),
    close() {
      hooks.beforeClose?.();
      for (const stmt of cache.values()) stmt.finalize();
      cache.clear();
      db.close();
    },
  };
}
