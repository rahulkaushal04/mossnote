import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import type { Result } from '../../packages/core/src/result.ts';
import { openWorkspace, type Workspace } from '../../packages/core/src/workspace.ts';
import {
  createFaultDb,
  dumpDb,
  DB_FAULT_CODES,
  isCommit,
  type FaultDb,
  type FaultMode,
} from '../../packages/core/src/testing/fault.ts';

export const DAY = 86_400_000;
export const MIN = 60_000;
export const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};

export interface Ctx {
  w: Workspace;
  ctl: FaultDb;
  clock: { t: number };
  dir: string;
  fx: Fixture;
}
export interface Fixture {
  F: string;
  S: string;
  T: string;
  N: string;
  M: string;
  trashedNote: string;
  trashedNoteBatch: string;
  trashedFolderBatch: string;
  tagA: string;
  tagB: string;
  oldVersion: string;
  headVersion: string;
}
export interface Scenario {
  name: string;
  /** Fault-free preparation after the fixture. */
  prep?(c: Ctx): void;
  /** The mutation under test. */
  op(c: Ctx): Result<unknown>;
}
export interface Noise {
  kind: 'note' | 'folder' | 'tag' | 'edit' | 'fav';
  text: string;
}

const long = (s: string) => `${s}\n${'lorem ipsum dolor '.repeat(30)}`;

function build(c: Omit<Ctx, 'fx'>, noise: Noise[]): Fixture {
  const { w, clock } = c;
  const F = unwrap(w.folders.create({}, { name: 'F' })).id;
  const S = unwrap(w.folders.create({}, { name: 'S', parentId: F })).id;
  const T = unwrap(w.folders.create({}, { name: 'T' })).id;
  const N = unwrap(w.notes.create({}, { title: 'N', body: 'hello', folderId: F })).id;
  clock.t += 6 * MIN;
  unwrap(w.notes.update({}, N, { body: long('second') }));
  clock.t += 6 * MIN;
  unwrap(w.notes.update({}, N, { body: long('third') }));
  const M = unwrap(w.notes.create({}, { title: 'M', body: 'm body', folderId: S })).id;
  const tagA = unwrap(w.tags.create({}, 'alpha')).id;
  const tagB = unwrap(w.tags.create({}, 'beta')).id;
  unwrap(w.tags.tagNote({}, N, tagA));
  unwrap(w.tags.tagNote({}, M, tagB));
  const trashedNote = unwrap(w.notes.create({}, { title: 'gone', body: 'gone body' })).id;
  const trashedNoteBatch = unwrap(w.trash.trashNote({}, trashedNote)).batchId;
  const tf = unwrap(w.folders.create({}, { name: 'trashed folder' })).id;
  unwrap(w.notes.create({}, { title: 'inside', body: 'x', folderId: tf }));
  const trashedFolderBatch = unwrap(w.trash.trashFolder({}, tf)).batchId;
  const vs = unwrap(w.versions.list(N));
  if (vs.length < 2) throw new Error('fixture needs >=2 versions');
  noise.forEach((n, i) => {
    clock.t += 1000;
    if (n.kind === 'note') unwrap(w.notes.create({}, { title: `x${i}`, body: n.text }));
    else if (n.kind === 'folder') unwrap(w.folders.create({}, { name: `x${i}` }));
    else if (n.kind === 'tag') unwrap(w.tags.create({}, `x${i}`));
    else if (n.kind === 'fav') unwrap(w.notes.setFavorite({}, M, i % 2 === 0));
    else unwrap(w.notes.update({}, M, { body: n.text }));
  });
  return {
    F,
    S,
    T,
    N,
    M,
    trashedNote,
    trashedNoteBatch,
    trashedFolderBatch,
    tagA,
    tagB,
    oldVersion: vs[vs.length - 1]!.id,
    headVersion: vs[0]!.id,
  };
}

/** A fixed set of fast-check generated starting states (plus the plain fixture). */
export const PREFIXES: Noise[][] = [
  [],
  ...fc.sample(
    fc.array(
      fc.record({
        kind: fc.constantFrom('note', 'folder', 'tag', 'edit', 'fav') as fc.Arbitrary<
          Noise['kind']
        >,
        text: fc.string({ maxLength: 400 }),
      }),
      { minLength: 1, maxLength: 4 },
    ),
    { numRuns: 2, seed: 20260607 },
  ),
];

export function openCtl(dir: string, clock: { t: number }, ctl: FaultDb): Workspace {
  const r = openWorkspace(join(dir, 'w.db'), { clock: { now: () => clock.t }, wrapDb: ctl.wrap });
  return unwrap(r);
}

const templates = new Map<string, { dir: string; fx: Fixture; t: number }>();
/** The fixture is built once per noise state and copied per case (the build fsyncs a lot). */
function template(noise: Noise[]) {
  const key = JSON.stringify(noise);
  let t = templates.get(key);
  if (!t) {
    const dir = mkdtempSync(join(tmpdir(), 'mossnote-fault-tpl-'));
    const clock = { t: 1_700_000_000_000 };
    const ctl = createFaultDb();
    const w = openCtl(dir, clock, ctl);
    const fx = build({ w, ctl, clock, dir }, noise);
    w.close(); // checkpoints the WAL into w.db
    t = { dir, fx, t: clock.t };
    templates.set(key, t);
  }
  return t;
}
process.on('exit', () => {
  for (const t of templates.values()) rmSync(t.dir, { recursive: true, force: true });
});

/** Fresh workspace at the scenario's starting state. Caller must `dispose`. */
export function start(sc: Scenario, noise: Noise[]): Ctx {
  const t = template(noise);
  const dir = mkdtempSync(join(tmpdir(), 'mossnote-fault-'));
  copyFileSync(join(t.dir, 'w.db'), join(dir, 'w.db'));
  const clock = { t: t.t };
  const ctl = createFaultDb();
  const w = openCtl(dir, clock, ctl);
  const c: Ctx = { w, ctl, clock, dir, fx: t.fx };
  sc.prep?.(c);
  return c;
}
export function dispose(c: Ctx): void {
  c.ctl.disarm();
  try {
    c.w.close();
  } catch {
    /* already closed */
  }
  rmSync(c.dir, { recursive: true, force: true });
}

/** Statement log of one fault-free run of the op (n = length). */
export function dryRun(sc: Scenario, noise: Noise[]): string[] {
  const c = start(sc, noise);
  try {
    c.ctl.arm();
    const r = sc.op(c);
    if (!r.ok) throw new Error(`dry run of ${sc.name} failed: ${r.error.message}`);
    return [...c.ctl.sqls];
  } finally {
    dispose(c);
  }
}

/** Runs the op with a fault at statement k; returns every violated invariant (empty = correct). */
export function runCase(sc: Scenario, noise: Noise[], k: number, mode: FaultMode): string[] {
  const code = DB_FAULT_CODES[(k + (mode === 'pre' ? 0 : 1)) % DB_FAULT_CODES.length]!;
  const c = start(sc, noise);
  const bad: string[] = [];
  try {
    const raw = c.ctl.raw;
    const before = dumpDb(raw);
    c.ctl.arm({ k, mode, code });
    let r: Result<unknown>;
    try {
      r = sc.op(c);
    } catch (e) {
      return [`threw instead of returning a Result: ${String(e)}`];
    }
    c.ctl.disarm();
    if (!c.ctl.fired) return ['fault never fired'];
    if (r.ok) bad.push('op reported success despite the fault');
    else if (r.error.code !== 'io') bad.push(`error code ${r.error.code}, expected io`);
    if (dumpDb(raw) !== before) bad.push('dump changed after failed mutation');
    const ic = raw.pragma('integrity_check', { simple: true });
    if (ic !== 'ok') bad.push(`integrity_check: ${String(ic)}`);
    if (raw.inTransaction) bad.push('transaction left open');
    const next = c.w.notes.create({}, { title: 'next', body: 'next write' });
    if (!next.ok) bad.push(`next write failed: ${next.error.message}`);
    // close() now flushes drafts that a faulted flush left pending (M7); do it here so the dump
    // taken before close is comparable with the one after reopen.
    c.w.drafts.flush();
    const after = dumpDb(raw);
    c.w.close();
    const re = openWorkspace(join(c.dir, 'w.db'), { clock: { now: () => c.clock.t } });
    if (!re.ok) bad.push(`reopen failed: ${re.error.code}`);
    else {
      const d2 = dumpDb(re.value.store.db);
      if (d2 !== after) bad.push('dump differs after reopen');
      re.value.close();
    }
    return bad;
  } finally {
    dispose(c);
  }
}

export interface SweepStats {
  combos: number;
}
/** Every (prefix, k, mode) for the scenario, skipping after-effect on COMMIT. Returns violations tagged. */
export function sweep(
  sc: Scenario,
  stats: SweepStats,
  { prefixes = PREFIXES, afterBegin = false } = {},
): string[] {
  const out: string[] = [];
  for (const [pi, noise] of prefixes.entries()) {
    const sqls = dryRun(sc, noise);
    sqls.forEach((sql, i) => {
      for (const mode of ['pre', 'after'] as const) {
        // The post-purge WAL scrub is best effort by design (the purge is committed): a failed
        // checkpoint must not fail the op, so it is not a fault target; core's round1 test covers it.
        // Same for the post-commit search-index optimize and stash clear that precede it (search/damage.ts afterPurge).
        if (/wal_checkpoint|VALUES \('optimize'\)|DELETE FROM search_stash/i.test(sql)) continue;
        const begin = /^\s*BEGIN\b/i.test(sql);
        if (afterBegin ? mode !== 'after' || !begin : mode === 'after' && isCommit(sql)) continue;
        stats.combos++;
        for (const v of runCase(sc, noise, i + 1, mode))
          out.push(
            `${sc.name} prefix#${pi} k=${i + 1}/${sqls.length} (${sql.slice(0, 40)}) ${mode}: ${v}`,
          );
      }
    });
  }
  return out;
}
