/**
 * Verified restore (PT-8..PT-10, CS-9, CS-13; decisions C1, M6, M7).
 *
 *  stageRestore   runs while the app is live. Streams the package into `<dbDir>/.restore-<ulid>/`,
 *                 verifies everything, migrates/rotates the staged copy, writes `restore-pending.json`.
 *                 The live data is never touched; any failure removes the stage.
 *  applyPendingRestore  runs at startup BEFORE openWorkspace, under the workspace lock. The swap is a list of
 *                 renames recorded in the journal before the first one runs. Each move's state is derived
 *                 from the file system, so a kill at any point is replayed: rolled forward when the staged
 *                 files are all still there and verify, otherwise rolled back. -wal and -shm move first and
 *                 the staged db is never placed while either exists. openWorkspace refuses to start (and so
 *                 never creates an empty workspace) while the journal exists.
 */
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { MIGRATIONS } from '../../migrations/index.ts';
import type { AttachFs } from '../attachments/fsport.ts';
import { blobPathIn } from '../attachments/scan.ts';
import type { Clock } from '../db/types.ts';
import { createUlid } from '../ids/ulid.ts';
import { indexVerdict } from '../integrity/check.ts';
import { acquireLock } from '../lock/index.ts';
import { err, ok, type Result } from '../result.ts';
import { SEARCH_TRIGGER_NAMES } from '../search/ddl.ts';
import { createSearchApi } from '../search/index.ts';
import { APPLICATION_ID, openStore } from '../store/store.ts';
import { SCHEMA_LATEST, packageSource, type Progress } from './backup.ts';
import { corrupt, NO_SPACE, PortError, toPortResult } from './errors.ts';
import { hashFile, MiB, rmQuiet } from './io.ts';
import { readPackage, type Manifest } from './package.ts';
import type { TarSink } from './tar.ts';

export const JOURNAL = 'restore-pending.json';
export const KEEP_PRE_RESTORE = 2;

const SHA = z.string().regex(/^[0-9a-f]{64}$/);
const NAME = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);
const REL = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}(\/[A-Za-z0-9._-]{1,100}){0,2}$/)
  .refine((p) => p.split('/').every((s) => s !== '.' && s !== '..'));
const journalSchema = z
  .object({
    v: z.literal(1),
    phase: z.enum(['staged', 'swapping']),
    stage: z.string().regex(/^\.restore-[0-9A-Z]{26}$/),
    db: NAME,
    att: NAME,
    verified: SHA,
    aside: z.string().regex(/^pre-restore-\d{8}T\d{6}Z(-\d+)?$/).optional(),
    moves: z.array(z.object({ from: REL, to: REL }).strict()).max(8).optional(),
  })
  .strict();
type Journal = z.infer<typeof journalSchema>;
interface Move {
  from: string;
  to: string;
}

export const journalPath = (dbPath: string): string => join(dirname(dbPath), JOURNAL);
export const pendingRestoreExists = (dbPath: string): boolean => lexists(journalPath(dbPath));

function lexists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* some platforms refuse; the rename is atomic anyway */
  }
}

function writeJournal(dir: string, j: Journal): void {
  const p = join(dir, JOURNAL);
  const tmp = `${p}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, JSON.stringify(j));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, p);
  fsyncDir(dir);
}

function hashFileSync(path: string): string {
  const h = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(MiB);
    for (;;) {
      const n = readSync(fd, buf, 0, MiB, null);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

const stampOf = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/* ------------------------------------------------------------------------------------------------ */
/* Staging                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export interface RestoreDeps {
  dbPath: string;
  /** Attachments blob directory; must live directly inside the database directory. */
  root: string;
  fs: AttachFs;
  clock: Clock;
}
export interface RestoreRequest {
  /** Absolute path of a `.mossbak` (resolved by the caller from a library id or a main-process pick). */
  file: string;
  passphrase?: string;
  onProgress?: Progress;
  signal?: AbortSignal;
}
export interface StagedRestore {
  backupCreatedAt: string;
  noteCount: number;
  damaged: number;
}

function fileSink(fs: AttachFs, path: string): TarSink {
  fs.mkdirp(dirname(path));
  const fd = fs.openNew(path);
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    fs.close(fd);
  };
  return {
    write: (c) => fs.write(fd, c, c.length),
    end() {
      fs.fsync(fd);
      close();
    },
    abort() {
      try {
        close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** M6/M7: nothing from the package is trusted. Read-only, trusted_schema off, no unexpected objects. */
function verifyStagedDb(path: string, m: Manifest): void {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    db.pragma('trusted_schema = OFF');
    const rows = db.pragma('integrity_check') as { integrity_check: string }[];
    if ((rows.length !== 1 || rows[0]!.integrity_check !== 'ok') && indexVerdict(path) !== 'index')
      throw corrupt('The backup database failed its integrity check.'); // search-index-only damage is rebuilt after the restore
    if ((db.pragma('application_id', { simple: true }) as number) !== APPLICATION_ID) throw corrupt('This is not a Mossnote backup.');
    const uv = db.pragma('user_version', { simple: true }) as number;
    if (uv > SCHEMA_LATEST)
      throw new PortError('unavailable', 'This backup was created by a newer Mossnote. Update the app to restore it.');
    if (uv !== m.schemaVersion) throw corrupt();
    const n = (db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n;
    const f = (db.prepare('SELECT count(*) AS n FROM folders').get() as { n: number }).n;
    if (n !== m.noteCount || f !== m.folderCount)
      throw corrupt('The note count in this backup does not match its checksums.');
    // Only the triggers/views a normal workspace of this version has (or the search ones, rebuilt later).
    const mem = new Database(':memory:');
    const allowed = new Set<string>(SEARCH_TRIGGER_NAMES);
    try {
      for (const mig of MIGRATIONS.slice(0, uv)) mem.exec(mig.sql);
      for (const r of mem.prepare("SELECT name FROM sqlite_schema WHERE type IN ('trigger','view')").all() as { name: string }[])
        allowed.add(r.name);
    } finally {
      mem.close();
    }
    for (const r of db.prepare("SELECT name FROM sqlite_schema WHERE type IN ('trigger','view')").all() as { name: string }[])
      if (!allowed.has(r.name)) throw corrupt('This backup contains unexpected database objects.');
    // M7: manifest attachments = database rows.
    const hasTable = !!db.prepare("SELECT 1 AS x FROM sqlite_schema WHERE type = 'table' AND name = 'attachments'").get();
    const have = new Map(
      (hasTable ? (db.prepare('SELECT sha256, size FROM attachments').all() as { sha256: string; size: number }[]) : []).map((r) => [r.sha256, r.size]),
    ); // a backup older than the attachments migration has no table: its manifest must list none
    const want = new Map(m.attachments.map((a) => [a.sha256, a.size]));
    for (const d of m.damaged) if (!want.has(d.sha256)) want.set(d.sha256, -1);
    if (have.size !== want.size) throw corrupt('The attachments in this backup do not match its database.');
    for (const [s, size] of want) if (!have.has(s) || (size >= 0 && have.get(s) !== size)) throw corrupt('The attachments in this backup do not match its database.');
  } catch (e) {
    if (e instanceof PortError) throw e;
    throw corrupt('The backup database could not be read.');
  } finally {
    db.close();
  }
}

export async function stageRestore(d: RestoreDeps, req: RestoreRequest): Promise<Result<StagedRestore>> {
  const dir = dirname(d.dbPath);
  const progress = req.onProgress ?? (() => undefined);
  const ulid = createUlid(() => d.clock.now());
  let stage: string | undefined;
  try {
    if (pendingRestoreExists(d.dbPath)) return err('conflict', 'A restore is already waiting for the next start.');
    if (dirname(d.root) !== dir) return err('unavailable', 'Restore needs the attachments folder next to the database.');
    const st = lstatSync(req.file);
    if (!st.isFile()) return err('validation', 'Choose a Mossnote backup file.');
    const free = d.fs.freeBytes(dir);
    if (free !== undefined && st.size + 64 * MiB > free) return err('io', NO_SPACE);
    const name = `.restore-${ulid()}`;
    stage = join(dir, name);
    mkdirSync(stage, { mode: 0o700 });
    const stagedDb = join(stage, 'mossnote.db');
    const stageAtt = join(stage, 'attachments');
    progress('reading', 0, 1);
    const read = await readPackage(
      packageSource(req.file, req.passphrase),
      { db: () => fileSink(d.fs, stagedDb), blob: (sha) => fileSink(d.fs, blobPathIn(stageAtt, sha)) },
      { maxSchema: SCHEMA_LATEST, maxTotal: free === undefined ? Infinity : free - 64 * MiB, signal: req.signal },
    );
    const m = read.manifest;
    progress('checking', 0, 1);
    verifyStagedDb(stagedDb, m);
    for (const x of m.damaged) if (x.reason === 'corrupt') rmQuiet(blobPathIn(stageAtt, x.sha256));
    for (const x of [`${stagedDb}-wal`, `${stagedDb}-shm`]) rmQuiet(x);

    const opened = openStore(stagedDb, { guards: [], clock: d.clock }); // migrates an older backup
    if (!opened.ok) throw new PortError(opened.error.code, opened.error.message, opened.error.cause);
    const store = opened.value;
    try {
      const rot = store.rotateDeviceId(); // CS-13: a restored copy is a new device; sync reconciles fully
      if (!rot.ok) throw new PortError(rot.error.code, rot.error.message);
      const dirty = createSearchApi(store).markDirty('restore');
      if (!dirty.ok) throw new PortError(dirty.error.code, dirty.error.message);
      const mark = store.db.prepare('UPDATE attachments SET verify_state = ? WHERE sha256 = ?');
      for (const x of m.damaged) mark.run(x.reason, x.sha256);
    } finally {
      const c = store.close();
      if (!c.ok) throw new PortError(c.error.code, c.error.message);
    }
    rmQuiet(join(stage, 'backups'));
    if (lexists(`${stagedDb}-wal`) || lexists(`${stagedDb}-shm`))
      throw new PortError('internal', 'The staged database still has a write-ahead log.');
    const verified = (await hashFile(stagedDb)).sha256;
    writeFileSync(join(stage, 'VERIFIED'), verified);
    fsyncDir(stage);
    writeJournal(dir, { v: 1, phase: 'staged', stage: name, db: basename(d.dbPath), att: basename(d.root), verified });
    progress('staged', 1, 1);
    return ok({ backupCreatedAt: m.createdAt, noteCount: m.noteCount, damaged: m.damaged.length });
  } catch (e) {
    if (stage) rmQuiet(stage);
    return toPortResult(e);
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Swap at startup                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

export interface ApplyOptions {
  clock?: Clock;
  /** Test seam: called before every step; a throw models a crash at that point. */
  onStep?: (label: string) => void;
}
export interface ApplyResult {
  applied: boolean;
  /** Why a staged restore was dropped (live data untouched or restored). */
  discarded?: string;
  aside?: string;
}

function doMove(dir: string, m: Move): void {
  const from = join(dir, m.from);
  const to = join(dir, m.to);
  const fe = lexists(from);
  const te = lexists(to);
  if (fe && te) throw new PortError('internal', `Restore step blocked: ${m.to} already exists.`);
  if (!fe) return; // already moved, or never existed
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

function plan(j: Journal, aside: string, dir: string): Move[] {
  const moves: Move[] = [];
  for (const n of [`${j.db}-wal`, `${j.db}-shm`, j.db, j.att])
    if (lexists(join(dir, n))) moves.push({ from: n, to: `${aside}/${n}` });
  moves.push({ from: `${j.stage}/mossnote.db`, to: j.db });
  if (lexists(join(dir, j.stage, 'attachments'))) moves.push({ from: `${j.stage}/attachments`, to: j.att });
  return moves;
}

/** Whether `m` is one of the moves this journal could have planned (a tampered journal cannot name other paths). */
function allowedMove(j: Journal, m: Move): boolean {
  if (!j.aside) return false;
  const live = [`${j.db}-wal`, `${j.db}-shm`, j.db, j.att];
  if (live.includes(m.from) && m.to === `${j.aside}/${m.from}`) return true;
  return (
    (m.from === `${j.stage}/mossnote.db` && m.to === j.db) ||
    (m.from === `${j.stage}/attachments` && m.to === j.att)
  );
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function prune(dir: string, keep: string): void {
  const olds = readdirSync(dir)
    .filter((n) => /^pre-restore-\d{8}T\d{6}Z(-\d+)?$/.test(n))
    .sort()
    .reverse();
  for (const n of olds.slice(KEEP_PRE_RESTORE)) if (n !== keep) rmQuiet(join(dir, n));
}

export function applyPendingRestore(dbPath: string, opts: ApplyOptions = {}): Result<ApplyResult> {
  const dir = dirname(dbPath);
  const jp = join(dir, JOURNAL);
  if (!lexists(jp)) return ok({ applied: false });
  const step = opts.onStep ?? (() => undefined);
  let lock = acquireLock(dir);
  for (let i = 0; !lock.ok && i < 20; i++) {
    sleepSync(250); // the previous process may still be quitting
    lock = acquireLock(dir);
  }
  if (!lock.ok) return lock;
  const held = lock.value;
  try {
    let j: Journal;
    try {
      const p = journalSchema.safeParse(JSON.parse(readFileSync(jp, 'utf8')));
      if (!p.success) throw new Error('shape');
      j = p.data;
    } catch {
      return err('corrupt', 'A restore was started but its record is unreadable. Your data was not changed. Contact support before continuing.');
    }
    if (j.db !== basename(dbPath)) return err('corrupt', 'The pending restore belongs to a different database.');
    const stageDir = join(dir, j.stage);
    const finish = (discarded?: string, aside?: string): Result<ApplyResult> => {
      step('journal-delete');
      try {
        unlinkSync(jp);
      } catch {
        /* already gone */
      }
      fsyncDir(dir);
      rmQuiet(stageDir);
      if (aside) {
        try {
          rmdirSync(join(dir, aside)); // only when empty (nothing was moved)
        } catch {
          /* kept */
        }
      }
      return ok(discarded ? { applied: false, discarded } : { applied: true, aside });
    };

    if (j.phase === 'staged') {
      const sdb = join(stageDir, 'mossnote.db');
      let problem: string | undefined;
      if (!lexists(sdb)) problem = 'staged files are missing';
      else if (lexists(`${sdb}-wal`) || lexists(`${sdb}-shm`)) problem = 'staged database has a write-ahead log';
      else if (hashFileSync(sdb) !== j.verified) problem = 'staged database failed its checksum';
      if (problem) return finish(problem); // live data was never touched in this phase
      let aside = `pre-restore-${stampOf((opts.clock ?? { now: Date.now }).now())}`;
      for (let n = 2; lexists(join(dir, aside)); n++) aside = `${aside.replace(/-\d+$/, '')}-${n}`;
      j = { ...j, phase: 'swapping', aside, moves: plan({ ...j, aside }, aside, dir) };
      step('journal-swapping');
      writeJournal(dir, j);
    }

    const aside = j.aside!;
    const moves = j.moves ?? [];
    if (!moves.every((m) => allowedMove(j, m))) return err('corrupt', 'The pending restore record is not valid. Your data was not changed.');

    const rollback = (reason: string): Result<ApplyResult> => {
      try {
        for (const m of [...moves].reverse()) {
          step(`undo:${m.to}`);
          doMove(dir, { from: m.to, to: m.from });
        }
      } catch (e) {
        if (e instanceof PortError || (e as { code?: unknown }).code) return err('io', 'Restore could not be undone automatically; the journal was kept so the next start can retry.', e);
        throw e; // a simulated crash
      }
      return finish(reason, aside);
    };

    const stagedAt = (): string => (lexists(join(stageDir, 'mossnote.db')) ? join(stageDir, 'mossnote.db') : join(dir, j.db));
    const stageMoves = moves.filter((m) => m.from.startsWith(`${j.stage}/`));
    const canForward =
      stageMoves.length > 0 &&
      stageMoves.every((m) => lexists(join(dir, m.from)) || lexists(join(dir, m.to))) &&
      lexists(stagedAt()) &&
      hashFileSync(stagedAt()) === j.verified;
    if (!canForward) return rollback('restore could not be completed; your previous data was put back');

    for (const m of moves) {
      step(`move:${m.from}`);
      try {
        if (m.to === j.db && (lexists(join(dir, `${j.db}-wal`)) || lexists(join(dir, `${j.db}-shm`))))
          throw new PortError('internal', 'A write-ahead log is still next to the database.');
        doMove(dir, m);
      } catch (e) {
        if (e instanceof PortError || (e as { code?: unknown }).code) return rollback('a file could not be moved; your previous data was put back');
        throw e;
      }
    }
    step('verify');
    if (!lexists(join(dir, j.db)) || hashFileSync(join(dir, j.db)) !== j.verified)
      return rollback('the restored database failed verification; your previous data was put back');
    fsyncDir(dir);
    const r = finish(undefined, aside);
    prune(dir, aside);
    return r;
  } catch (e) {
    if (opts.onStep) throw e; // tests: a thrown step is a simulated crash and must reach the harness
    return toPortResult(e);
  } finally {
    held.release();
  }
}

/** Startup sweep: temp files of interrupted jobs. Never touches a staged restore the journal names. */
export function sweepTemp(dbPath: string): void {
  const dir = dirname(dbPath);
  let keep = '';
  try {
    keep = (JSON.parse(readFileSync(join(dir, JOURNAL), 'utf8')) as { stage?: string }).stage ?? '';
  } catch {
    /* no journal */
  }
  for (const n of safeReaddir(dir)) {
    if ((n.startsWith('.restore-') && n !== keep) || (n.startsWith('.export-') && n.endsWith('.sqlite')) || n === `${JOURNAL}.tmp`)
      rmQuiet(join(dir, n));
  }
  const lib = join(dir, 'backups');
  for (const n of safeReaddir(lib))
    if (n.endsWith('.tmp') || n.startsWith('.snap-')) rmQuiet(join(lib, n));
}

function safeReaddir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

