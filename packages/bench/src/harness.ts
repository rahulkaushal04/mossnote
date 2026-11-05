import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createDispatcher, openWorkspace, type Workspace } from '../../core/src/index.ts';
import { DEFAULT_SEED, ensureDataset, SIZES, type SizeName } from './dataset.ts';
import { detectEnv, type Env } from './env.ts';
import { registeredMetrics } from './hooks.ts';
import { buildQuerySet, CATEGORIES, type QuerySpec } from './queries.ts';
import { makeRng } from './rng.ts';
import { summarize, type Summary } from './stats.ts';
import { folderCountFor, folderPlan, makeBody, TAG_POOL } from './text.ts';

export interface MetricResult {
  unit: 'ms';
  summary: Summary;
  /** Raw samples, kept so the numbers can be re-derived. */
  samples: number[];
  targetP95Ms?: number;
}
export interface BenchResult {
  schema: 1;
  size: SizeName;
  notes: number;
  seed: number;
  datasetHash: string;
  generateSeconds: number;
  quick: boolean;
  startedAt: string;
  env: Env;
  metrics: Record<string, MetricResult>;
  /** Per-category search p95 (ms) and the slowest queries. */
  searchByCategory: Record<string, Summary>;
  slowestQueries: { query: string; category: string; ms: number; hits: number }[];
  scalars: Record<string, number | string | null>;
  notRun: string[];
}

export interface RunOptions {
  size: SizeName;
  dataDir: string;
  quick?: boolean;
  seed?: number;
  /** Repetitions for open/autosave/note-open; PB-2 asks for at least 30. */
  reps?: number;
  log?: (m: string) => void;
}

const childPath = fileURLToPath(new URL('./open-child.ts', import.meta.url));

interface ChildOut {
  openMs: number;
  sinceProcessStart: number;
  wallMs: number;
  error?: string;
}

/** One spawn: wall time from spawn to the "ready" line, plus the child's own numbers. */
function spawnOpen(dbPath: string): Promise<ChildOut> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const c = spawn(process.execPath, [childPath, dbPath], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    let wall = 0;
    c.stdout.on('data', (d: Buffer) => {
      if (!wall) wall = performance.now() - t0;
      buf += d.toString();
    });
    c.on('error', reject);
    c.on('close', () => {
      try {
        const o = JSON.parse(buf.trim().split('\n').pop() ?? '') as ChildOut;
        if (o.error) reject(new Error(o.error));
        else resolve({ ...o, wallMs: wall });
      } catch (e) {
        reject(e);
      }
    });
  });
}

const fileSize = (p: string): number => {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
};
const time = <T>(f: () => T): [number, T] => {
  const t = performance.now();
  const v = f();
  return [performance.now() - t, v];
};
const metric = (samples: number[], targetP95Ms?: number): MetricResult => ({
  unit: 'ms',
  summary: summarize(samples),
  samples,
  ...(targetP95Ms === undefined ? {} : { targetP95Ms }),
});
const mb = (n: number): number => Math.round((n / 2 ** 20) * 10) / 10;

export async function runBench(o: RunOptions): Promise<BenchResult> {
  const log = o.log ?? (() => {});
  const seed = o.seed ?? DEFAULT_SEED;
  const count = SIZES[o.size];
  const reps = Math.max(30, o.reps ?? 30);
  const ds = ensureDataset(o.dataDir, count, seed, log);
  const work = join(o.dataDir, `run-${o.size}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const dbPath = join(work, 'workspace.sqlite');
  copyFileSync(ds.path, dbPath);

  const res: BenchResult = {
    schema: 1,
    size: o.size,
    notes: count,
    seed,
    datasetHash: ds.hash,
    generateSeconds: ds.generateSeconds,
    quick: !!o.quick,
    startedAt: new Date().toISOString(),
    env: detectEnv(),
    metrics: {},
    searchByCategory: {},
    slowestQueries: [],
    scalars: {},
    notRun: [
      'UI start time (process spawn to "list rendered") and note-open-in-the-UI: needs Electron, run by the user',
    ],
  };
  const sc = res.scalars;
  sc.datasetDbMB = mb(fileSize(dbPath));

  // Warm open: separate processes, warm OS file cache (one unmeasured spawn first).
  log('open: warm spawns');
  await spawnOpen(dbPath);
  const wall: number[] = [];
  const core: number[] = [];
  const boot: number[] = [];
  for (let i = 0; i < reps; i++) {
    const c = await spawnOpen(dbPath);
    wall.push(c.wallMs);
    core.push(c.openMs);
    boot.push(c.sinceProcessStart);
  }
  res.metrics['open.warm.spawnToReady'] = metric(wall);
  res.metrics['open.warm.openWorkspace'] = metric(core);
  res.metrics['open.warm.sinceProcessStart'] = metric(boot);
  // Cold needs the OS file cache purged, which needs root; try, and say so if it is refused.
  if (!o.quick) {
    const p = spawnSync('purge', [], { stdio: 'ignore' });
    if (p.status === 0) {
      const c = await spawnOpen(dbPath);
      sc.coldOpenSpawnToReadyMs = c.wallMs;
      sc.coldOpenWorkspaceMs = c.openMs;
    } else
      res.notRun.push(
        'Cold open: `purge` (clears the OS file cache) needs root; run `sudo purge` first or reboot, then `npm run bench` as the first launch',
      );
  }

  const opened = openWorkspace(dbPath);
  if (!opened.ok) throw new Error(opened.error.message);
  const ws: Workspace = opened.value;
  const disp = createDispatcher(opened);
  sc.rssIdleMB = mb(process.memoryUsage().rss);
  const db = ws.store.db;
  const one = (sql: string, ...p: unknown[]): number =>
    Object.values(db.prepare(sql).get(...p) as Record<string, number>)[0] as number;
  sc.sqliteVersion = res.env.sqlite;
  try {
    sc.indexMB = mb(one("SELECT sum(pgsize) FROM dbstat WHERE name LIKE 'note_fts%'"));
  } catch {
    sc.indexMB = null;
  }
  sc.notesInDb = one('SELECT count(*) FROM notes');
  sc.trashedNotes = one('SELECT count(*) FROM notes WHERE trashed_at IS NOT NULL');
  sc.folders = one('SELECT count(*) FROM folders');
  sc.tags = one('SELECT count(*) FROM tags');
  sc.noteBodyMB = mb(one('SELECT sum(length(body)) FROM notes'));
  const lens = (
    db.prepare('SELECT length(body) AS l FROM notes ORDER BY l').all() as { l: number }[]
  ).map((r) => r.l);
  sc.bodyMedianBytes = lens[Math.floor(lens.length / 2)] ?? 0;
  sc.bodyP99Bytes = lens[Math.floor(lens.length * 0.99)] ?? 0;

  // --- search: 200 fixed queries, one unmeasured pass then `passes` measured passes ---
  log('search');
  const tl = ws.tags.list();
  const tagId = new Map((tl.ok ? tl.value : []).map((t) => [t.name, t.id]));
  const fplan = folderPlan(seed, folderCountFor(count));
  const folderByName = new Map(
    (db.prepare('SELECT id, name FROM folders').all() as { id: string; name: string }[]).map(
      (f) => [f.name, f.id],
    ),
  );
  const params = (q: QuerySpec) => {
    const filters: Record<string, unknown> = {};
    if (q.tag && tagId.get(q.tag)) filters.tagIds = [tagId.get(q.tag)];
    if (q.folder !== undefined)
      filters.folderIds = [folderByName.get((fplan[q.folder] as { name: string }).name)];
    if (q.createdFrom !== undefined)
      Object.assign(filters, { createdFrom: q.createdFrom, createdTo: q.createdTo });
    return { query: q.query, filters };
  };
  const qs = buildQuerySet();
  const runQ = async (q: QuerySpec): Promise<[number, number]> => {
    const t = performance.now();
    const r = (await disp.handle('search.run', params(q))) as {
      ok: boolean;
      value?: { hits: unknown[] };
      error?: { message: string };
    };
    const ms = performance.now() - t;
    if (!r.ok) throw new Error(`search failed for ${q.query}: ${r.error?.message}`);
    return [ms, r.value?.hits.length ?? 0];
  };
  for (const q of qs) await runQ(q);
  const passes = o.quick ? 1 : 3;
  const per = qs.map(() => [] as number[]);
  const hits = qs.map(() => 0);
  for (let p = 0; p < passes; p++)
    for (let i = 0; i < qs.length; i++) {
      const [ms, h] = await runQ(qs[i] as QuerySpec);
      (per[i] as number[]).push(ms);
      hits[i] = h;
    }
  res.metrics['search'] = metric(per.flat(), 100);
  for (const c of CATEGORIES)
    res.searchByCategory[c] = summarize(
      per.flatMap((s, i) => ((qs[i] as QuerySpec).category === c ? s : [])),
    );
  res.slowestQueries = qs
    .map((q, i) => ({
      query: q.query,
      category: q.category,
      ms: summarize(per[i] as number[]).p50,
      hits: hits[i] as number,
    }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);
  sc.rssAfterSearchMB = mb(process.memoryUsage().rss);

  // --- note open ---
  log('note open');
  const rng = makeRng(seed + 1);
  const ids = (
    db.prepare('SELECT id FROM notes WHERE trashed_at IS NULL ORDER BY id').all() as {
      id: string;
    }[]
  ).map((r) => r.id);
  const openIds = Array.from({ length: 300 }, () => rng.pick(ids));
  for (const id of openIds.slice(0, 20)) await disp.handle('notes.get', { id });
  const opens: number[] = [];
  for (const id of openIds) {
    const t = performance.now();
    const r = (await disp.handle('notes.get', { id })) as { ok: boolean };
    opens.push(performance.now() - t);
    if (!r.ok) throw new Error('notes.get failed');
  }
  res.metrics['noteOpen'] = metric(opens, 100);

  // --- autosave through the dispatcher, with the index ---
  log('autosave');
  const body = makeBody;
  for (const [name, size] of [
    ['autosave.1_5k', 1500],
    ['autosave.50k', 50_000],
  ] as const) {
    const s: number[] = [];
    const r = makeRng(seed + size);
    for (let i = 0; i < Math.max(200, reps); i++) {
      const id = r.pick(ids);
      const cur = (await disp.handle('notes.get', { id })) as {
        ok: boolean;
        value: { contentHash: string };
      };
      const text = body(r, size);
      const t = performance.now();
      const out = (await disp.handle('notes.save', {
        id,
        body: text,
        expectedContentHash: cur.value.contentHash,
      })) as { ok: boolean };
      s.push(performance.now() - t);
      if (!out.ok) throw new Error('notes.save failed');
    }
    res.metrics[name] = metric(s);
  }
  const [optMs] = time(() => db.exec("INSERT INTO note_fts(note_fts) VALUES('optimize')"));
  sc.ftsOptimizeAfterAutosaveMs = Math.round(optMs);

  // --- 1,000 tag renames / merges (500 + 500); setup is untimed and uses relaxed durability ---
  log('tags');
  db.pragma('synchronous = OFF');
  const bench: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const t = ws.tags.create({}, `bench-src-${i}`);
    if (!t.ok) throw new Error(t.error.message);
    bench.push(t.value.id);
    for (let k = 0; k < 5; k++) ws.tags.tagNote({}, rng.pick(ids), t.value.id);
  }
  db.pragma('synchronous = FULL');
  const tagOps: number[] = [];
  const t0 = performance.now();
  // Merges end in a full FTS optimize (cost grows with the index), so at 100k they are time-boxed:
  // all 500 renames, then merges until 500 or until the box is spent (but at least 30).
  const mergeBoxMs = 10 * 60_000;
  let tMerge = 0;
  for (let i = 0; i < 1000; i++) {
    const merge = i >= 500;
    if (merge && i >= 530 && tMerge > mergeBoxMs) break;
    const args = merge
      ? { id: bench[i], name: TAG_POOL[1 + (i % 59)], confirmMerge: true }
      : { id: bench[i], name: `bench-renamed-${i}` };
    const t = performance.now();
    const r = (await disp.handle('tags.rename', args)) as { ok: boolean };
    const d = performance.now() - t;
    tagOps.push(d);
    if (merge) tMerge += d;
    if (!r.ok) throw new Error('tags.rename failed');
  }
  const merges = tagOps.length - 500;
  sc.tagRenamesRun = 500;
  sc.tagMergesRun = merges;
  sc.tagOpsMeasuredTotalMs = Math.round(performance.now() - t0);
  const ren = tagOps.slice(0, 500).reduce((x, y) => x + y, 0);
  // Estimated, not measured, when the merge box cut the run short.
  sc.tagOps1000TotalMs = Math.round(ren + (tMerge / merges) * 500);
  sc.tagOps1000Estimated = merges < 500 ? 'yes (merges extrapolated from the measured mean)' : 'no';
  res.metrics['tagOps'] = metric(tagOps);
  res.metrics['tagOps.rename'] = metric(tagOps.slice(0, 500));
  res.metrics['tagOps.merge'] = metric(tagOps.slice(500));
  const bigId = tagId.get(TAG_POOL[0] as string);
  if (bigId) {
    sc.bigTagMembers = one('SELECT count(*) FROM note_tags WHERE tag_id = ?', bigId);
    const [ms] = time(() => ws.tags.rename({}, bigId, 'work-renamed'));
    sc.bigTagRenameMs = Math.round(ms);
  }

  // --- PB-7 hooks ---
  for (const h of registeredMetrics()) {
    const s: number[] = [];
    for (let i = 0; i < reps; i++) s.push(await h.run({ ws, dispatcher: disp, size: count }, i));
    res.metrics[`hook.${h.id}`] = metric(s, h.targetP95Ms);
  }

  // --- full chunked rebuild ---
  if (!o.quick) {
    log('rebuild');
    ws.search.markDirty('bench');
    const slices: number[] = [];
    const t = performance.now();
    for (;;) {
      const [ms, r] = time(() => ws.search.rebuildStep());
      slices.push(ms);
      if (!r.ok) throw new Error(r.error.message);
      if (r.value.done) break;
    }
    sc.rebuildTotalMs = Math.round(performance.now() - t);
    sc.rebuildWorstSliceMs = Math.round(Math.max(...slices));
    sc.rebuildSlices = slices.length;
    res.metrics['rebuild.slice'] = metric(slices);
  } else res.notRun.push('Full rebuild skipped in quick mode');

  sc.dbFileMB = mb(fileSize(dbPath));
  sc.walFileMB = mb(fileSize(`${dbPath}-wal`));
  disp.close();
  rmSync(work, { recursive: true, force: true });
  return res;
}
