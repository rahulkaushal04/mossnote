import { dirname, join } from 'node:path';
import { z } from 'zod';
import { MIGRATIONS } from '../../migrations/index.ts';
import type { Migration } from '../../migrations/types.ts';
import { appendChange, type ChangeInput } from '../changelog/append.ts';
import {
  applyRemoteChange,
  type ApplyRemoteOptions,
  type RemoteChange,
} from '../changelog/apply.ts';
import { readChanges, type ChangeRow } from '../changelog/read.ts';
import { toAppError } from '../db/errors.ts';
import { nodeFs, type FsPort } from '../db/fs.ts';
import { migrate, userVersion } from '../db/migrate.ts';
import { openDb } from '../db/open.ts';
import { createTxRunner } from '../db/tx.ts';
import {
  afterPurge,
  baseTablesIntact,
  indexSuspect,
  quarantineIndex,
  quarantineSql,
} from '../search/damage.ts';
import type { Clock, Db } from '../db/types.ts';
import { ensureIdentity, fingerprint, rotateDevice } from '../ids/identity.ts';
import { createUlid } from '../ids/ulid.ts';
import { integrityGuard } from '../integrity/index.ts';
import { lockGuard } from '../lock/index.ts';
import { err, ok, type Result } from '../result.ts';
import Database from 'better-sqlite3';

/** PRAGMA application_id of every Mossnote workspace ("MOSS"); set by migration 0001. */
export const APPLICATION_ID = 0x4d4f5353;

/** Every mutating call takes this. `actor` is the agent/system id (absent = the user). */
export const ctxSchema = z
  .object({
    actor: z.string().min(1).max(128).optional(),
    expectedContentHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    /** notes.update only: drafts of that note up to this seq are deleted in the same transaction. */
    draftSeq: z.number().int().min(0).optional(),
  })
  .strict();
export type Ctx = z.input<typeof ctxSchema>;

/** Handed to a mutation body; everything it does is in one BEGIN IMMEDIATE transaction. */
export interface Tx {
  db: Db;
  now: number;
  deviceId: string;
  ctx: Ctx;
  ulid(): string;
  /** Exactly one per user action. Fills in actor and the per-device seq/HLC. */
  log(change: Omit<ChangeInput, 'actorId'>): Result<string>;
  /** Compare-and-set guard: conflict when ctx.expectedContentHash is set and differs. */
  checkExpected(currentContentHash: string): Result<void>;
}

/** A guard runs before the read-write open (lock, integrity). Returns a release called on close. */
export type OpenGuard = (
  path: string,
  fs: FsPort,
) => Result<{ release?: () => void; indexDamaged?: boolean } | void>;

export interface OpenOptions {
  clock?: Clock;
  fs?: FsPort;
  migrations?: readonly Migration[];
  wrapDb?: (d: Db) => Db;
  platform?: string;
  /** Replaces the defaults, [lockGuard, integrityGuard]. Pass `[]` only in tests. */
  guards?: readonly OpenGuard[];
  /** Best-effort steps that did not complete (e.g. a busy WAL checkpoint after a remote purge). */
  onWarning?: (message: string) => void;
}

export interface Store {
  readonly db: Db;
  readonly fs: FsPort;
  readonly clock: Clock;
  readonly path: string;
  readonly workspaceId: string;
  readonly deviceId: string;
  mutate<T>(ctx: Ctx, fn: (tx: Tx) => Result<T>): Result<T>;
  /**
   * Like mutate, but `tx.log` may be called once per entity changed: a bulk action is N mutations
   * committed in ONE transaction (CS-3 note), each with its own change-log row. All or nothing: an
   * error result (or throw) rolls back every write and every row.
   */
  mutateMany<T>(ctx: Ctx, fn: (tx: Tx) => Result<T>): Result<T>;
  /**
   * Runs `fn`; the post-purge cleanup (index optimize, stash clear, WAL checkpoint) of every purge
   * committed inside it runs ONCE when the outermost batch ends, not after each commit.
   */
  batch<T>(fn: () => T): T;
  readonly changelog: {
    read(q: { afterDeviceSeq?: Record<string, number>; limit: number }): Result<ChangeRow[]>;
    /** Records a remote change verbatim; adds no local row. */
    applyRemote(
      change: RemoteChange,
      applyEntity?: (tx: Tx) => Result<void>,
      opts?: ApplyRemoteOptions,
    ): Result<boolean>;
  };
  /** Portability calls this after a restore. Not a user action: no change-log row. */
  rotateDeviceId(): Result<string>;
  /** Folds the WAL, closes the database, then releases the guards (lock). Always releases; an error means the close itself failed. */
  close(): Result<void>;
}

export function openStore(path: string, opts: OpenOptions = {}): Result<Store> {
  const fs = opts.fs ?? nodeFs;
  const clock = opts.clock ?? { now: () => Date.now() };
  const migrations = opts.migrations ?? MIGRATIONS;
  const releases: (() => void)[] = [];
  let indexDamaged = false;
  let db: Db | undefined;
  const cleanup = (): Result<void> => {
    let out: Result<void> = ok(undefined);
    try {
      db?.close();
    } catch (e) {
      out = toAppError(e); // still release the lock: holding it forever would lock the user out
    }
    for (const r of releases.reverse()) r();
    return out;
  };
  try {
    fs.mkdirp(dirname(path));
    for (const g of opts.guards ?? [lockGuard, integrityGuard]) {
      const r = g(path, fs);
      if (!r.ok) {
        cleanup();
        return r;
      }
      if (r.value?.release) releases.push(r.value.release);
      if (r.value?.indexDamaged) indexDamaged = true;
    }
    if (fs.exists(path)) {
      // Refuse a newer schema before any write (opening read-write may touch the WAL).
      const probe = new Database(path, { readonly: true, fileMustExist: true });
      try {
        const v = userVersion(probe);
        if (v > migrations.length) throw Object.assign(new Error('newer'), { newer: true });
        // Another app's SQLite file: refuse before openDb switches it to WAL (a header rewrite).
        const appId = probe.pragma('application_id', { simple: true }) as number;
        const has = (t: string) =>
          probe.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(t);
        const hasSchema = probe.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get();
        // Ours: our id, or an older dev database (no id yet) that has our tables; an empty file is fine.
        const ours =
          appId === APPLICATION_ID ||
          (appId === 0 && (v === 0 ? !hasSchema : has('change_log') && has('notes')));
        if (!ours) throw Object.assign(new Error('foreign'), { foreign: true });
      } catch (e) {
        if ((e as { newer?: boolean }).newer) {
          cleanup();
          return err('unavailable', 'This workspace was created by a newer Mossnote');
        }
        if ((e as { foreign?: boolean }).foreign) {
          cleanup();
          return err('validation', 'This file is not a Mossnote workspace');
        }
        throw e;
      } finally {
        probe.close();
      }
    }
    db = openDb(path, { wrapDb: opts.wrapDb, platform: opts.platform });
    // Damage confined to the search tables: stop the triggers BEFORE migrating (a data migration that
    // touches notes would otherwise run them against the damaged index); the rebuild comes later.
    if (indexDamaged) quarantineIndex(db, 'startup integrity check');
    const ulid = createUlid(() => clock.now());
    const m = migrate(db, fs, path, migrations, join(dirname(path), 'backups'), ulid);
    if (!m.ok) {
      cleanup();
      return m;
    }
    if ((db.pragma('application_id', { simple: true }) as number) === 0)
      db.pragma(`application_id = ${APPLICATION_ID}`); // older dev databases get the id on first open
    const run = createTxRunner(db);
    const d = db;
    let identity!: ReturnType<typeof ensureIdentity>;
    const idr = run(() => {
      identity = ensureIdentity(d, fs, path, ulid);
      return ok(undefined);
    });
    if (!idr.ok) {
      cleanup();
      return idr;
    }
    const schemaVersion = userVersion(d);
    const state = { deviceId: identity.deviceId };

    let sawPurge = false;
    const makeTx = (ctx: Ctx, noLog = false, many = false): Tx => {
      let logged = 0;
      const tx: Tx = {
        db: d,
        now: clock.now(),
        deviceId: state.deviceId,
        ctx,
        ulid,
        log(change) {
          // applyRemote's callback must never write a local row: that would re-broadcast the remote change.
          if (noLog) return err('internal', 'no local log inside applyRemote');
          if (++logged > 1 && !many) return err('internal', 'more than one change-log row for one action');
          if (change.op === 'purge') sawPurge = true;
          return appendChange(
            { db: d, deviceId: state.deviceId, schemaVersion, now: tx.now, ulid },
            { ...change, actorId: ctx.actor },
          );
        },
        checkExpected(hash) {
          return ctx.expectedContentHash && ctx.expectedContentHash !== hash
            ? err('conflict', 'content changed since it was read')
            : ok(undefined);
        },
      };
      return tx;
    };
    // A damaged search index must never block a write: when a failure looks index-caused AND every base
    // table the triggers read passes quick_check, retry ONCE in a new transaction with the triggers
    // dropped. If a base table is damaged (or the retry fails too) the ORIGINAL error is returned.
    let deferDepth = 0;
    let purgePending = false;
    const retrying = <T>(body: () => Result<T>): Result<T> => {
      const first = run(body);
      if (first.ok || !indexSuspect(first.error) || !baseTablesIntact(d)) return first;
      const again = run(() => {
        quarantineSql(d, `write failed: ${first.error.message}`);
        return body();
      });
      return again.ok ? again : first;
    };
    const mutateWith = <T>(raw: Ctx, many: boolean, fn: (tx: Tx) => Result<T>): Result<T> => {
      const c = ctxSchema.safeParse(raw);
      if (!c.success) return err('validation', c.error.message, c.error);
      const r = retrying(() => {
        sawPurge = false;
        return fn(makeTx(c.data, false, many));
      });
      if (r.ok && sawPurge) {
        if (deferDepth) purgePending = true;
        else afterPurge(d);
      }
      return r;
    };
    const mutate = <T>(raw: Ctx, fn: (tx: Tx) => Result<T>): Result<T> => mutateWith(raw, false, fn);
    const mutateMany = <T>(raw: Ctx, fn: (tx: Tx) => Result<T>): Result<T> =>
      mutateWith(raw, true, fn);
    const batch = <T>(fn: () => T): T => {
      deferDepth++;
      try {
        return fn();
      } finally {
        if (--deferDepth === 0 && purgePending) {
          purgePending = false;
          afterPurge(d);
        }
      }
    };

    let closed = false;
    const store: Store = {
      db: d,
      fs,
      clock,
      path,
      workspaceId: identity.workspaceId,
      get deviceId() {
        return state.deviceId;
      },
      mutate,
      mutateMany,
      batch,
      changelog: {
        read: (q) => {
          try {
            return readChanges(d, q);
          } catch (e) {
            return toAppError(e);
          }
        },
        applyRemote: (change, applyEntity, o) => {
          const r = retrying(() => {
            const tx = makeTx({}, true);
            return applyRemoteChange(
              d,
              state.deviceId,
              change,
              tx.now,
              applyEntity && (() => applyEntity(tx)),
              o,
            );
          });
          // After commit: fold the WAL so the purged text is not left in its old pages.
          if (r.ok && r.value && change.op === 'purge') {
            afterPurge(d);
            try {
              const cp = d.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
              if (cp[0]?.busy) opts.onWarning?.('WAL checkpoint busy after remote purge');
            } catch (e) {
              opts.onWarning?.(`WAL checkpoint failed after remote purge: ${String(e)}`);
            }
          }
          return r;
        },
      },
      rotateDeviceId() {
        const r = run(() => {
          state.deviceId = rotateDevice(d, ulid, fingerprint(fs, path));
          return ok(state.deviceId);
        });
        return r;
      },
      close() {
        if (closed) return ok(undefined);
        closed = true;
        try {
          d.pragma('wal_checkpoint(TRUNCATE)'); // folds the WAL so purged text does not linger in it
        } catch {
          /* best effort: the data is already committed */
        }
        return cleanup();
      },
    };
    return ok(store);
  } catch (e) {
    cleanup();
    return toAppError(e);
  }
}
