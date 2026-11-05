import type { FsPort } from '../db/fs.ts';
import type { Db, Stmt } from '../db/types.ts';

/** pre: throw INSTEAD of running statement k. after: run it, then throw (never used on COMMIT). */
export type FaultMode = 'pre' | 'after';
export const DB_FAULT_CODES = ['SQLITE_IOERR_WRITE', 'SQLITE_IOERR_FSYNC', 'SQLITE_FULL'] as const;

/** Shaped like better-sqlite3's SqliteError, which is what toAppError sees in production. */
export const sqliteError = (code: string): Error =>
  Object.assign(new Error(`injected ${code}`), { name: 'SqliteError', code });

export interface FaultDb {
  /** Pass as `wrapDb`. */
  wrap(d: Db): Db;
  /** The unwrapped connection, for dumps and pragmas that must never be faulted. */
  readonly raw: Db;
  /** Statements seen since arm(), in order (reads and pragmas included). */
  readonly sqls: readonly string[];
  /** Start counting from 1. With a fault, statement `k` fails. */
  arm(fault?: { k: number; mode: FaultMode; code: string }): void;
  disarm(): void;
  readonly fired: boolean;
}

export function createFaultDb(): FaultDb {
  let raw!: Db;
  let armed = false;
  let fault: { k: number; mode: FaultMode; code: string } | undefined;
  let fired = false;
  const sqls: string[] = [];

  const hit = <T>(sql: string, exec: () => T): T => {
    if (!armed) return exec();
    sqls.push(sql);
    if (fault && !fired && sqls.length === fault.k) {
      fired = true;
      if (fault.mode === 'pre') throw sqliteError(fault.code);
      const r = exec();
      void r;
      throw sqliteError(fault.code);
    }
    return exec();
  };

  return {
    wrap(d) {
      raw = d;
      return {
        prepare(sql): Stmt {
          const s = d.prepare(sql);
          return {
            run: (...p) => hit(sql, () => s.run(...p)),
            get: (...p) => hit(sql, () => s.get(...p)),
            all: (...p) => hit(sql, () => s.all(...p)),
          };
        },
        exec: (sql) => hit(sql, () => d.exec(sql)),
        pragma: (src, o) => hit(`PRAGMA ${src}`, () => d.pragma(src, o)),
        get inTransaction() {
          return d.inTransaction;
        },
        close: () => d.close(),
      };
    },
    get raw() {
      return raw;
    },
    sqls,
    arm(f) {
      sqls.length = 0;
      fired = false;
      fault = f;
      armed = true;
    },
    disarm() {
      armed = false;
    },
    get fired() {
      return fired;
    },
  };
}

/** Every table (incl. change_log, tombstones, versions, drafts, sqlite_sequence), as comparable JSON. */
export function dumpDb(d: Db): string {
  const tables = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return JSON.stringify(
    tables.map(({ name }) => [name, d.prepare(`SELECT * FROM "${name}"`).all()]),
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
  );
}

export const isCommit = (sql: string): boolean => /^\s*COMMIT\b/i.test(sql);

/** An FsPort that records every call and fails the k-th (1-based) with `code`, before or after the real op. */
export function createFaultFs(inner: FsPort) {
  let count = 0;
  let fault: { k: number; mode: FaultMode; code: string } | undefined;
  const calls: string[] = [];
  const wrapFn =
    <A extends unknown[], R>(name: string, f: (...a: A) => R) =>
    (...a: A): R => {
      calls.push(`${name}`);
      count++;
      if (fault && count === fault.k) {
        const e = Object.assign(new Error(`injected ${fault.code}`), { code: fault.code });
        if (fault.mode === 'pre') throw e;
        f(...a);
        throw e;
      }
      return f(...a);
    };
  const fs: FsPort = {
    mkdirp: wrapFn('mkdirp', inner.mkdirp),
    exists: wrapFn('exists', inner.exists),
    copyFile: wrapFn('copyFile', inner.copyFile),
    fsyncPath: wrapFn('fsyncPath', inner.fsyncPath),
    rename: wrapFn('rename', inner.rename),
    unlink: wrapFn('unlink', inner.unlink),
    stat: wrapFn('stat', inner.stat),
  };
  return {
    fs,
    calls,
    arm(f?: { k: number; mode: FaultMode; code: string }) {
      count = 0;
      calls.length = 0;
      fault = f;
    },
  };
}
