import type { BenchResult } from './harness.ts';
import { CATEGORIES } from './queries.ts';

export type Verdict = 'PASS' | 'FAIL' | 'NOT RUN' | 'NEEDS USER';
export interface TargetRow {
  target: string;
  verdict: Verdict;
  measured: string;
}

export interface Baseline {
  size: string;
  commit: string | null;
  recordedAt: string;
  /** p95 in ms per metric. */
  p95: Record<string, number>;
}

export const REGRESSION_LIMIT = 0.2;
/** Differences below this are timer noise at millisecond scale, not regressions. */
export const NOISE_FLOOR_MS = 0.5;

export const toBaseline = (r: BenchResult): Baseline => ({
  size: r.size,
  commit: r.env.commit,
  recordedAt: r.startedAt,
  p95: Object.fromEntries(Object.entries(r.metrics).map(([k, m]) => [k, m.summary.p95])),
});

export interface Regression {
  metric: string;
  baseline: number;
  fresh: number;
  pct: number;
}

/** PB-4: every metric present in both whose p95 grew by more than 20% (and by more than the noise floor). */
export function compare(base: Baseline, fresh: BenchResult): Regression[] {
  const out: Regression[] = [];
  for (const [metric, m] of Object.entries(fresh.metrics)) {
    const b = base.p95[metric];
    if (b === undefined || !Number.isFinite(b)) continue;
    const f = m.summary.p95;
    if (f > b * (1 + REGRESSION_LIMIT) && f - b > NOISE_FLOOR_MS)
      out.push({ metric, baseline: b, fresh: f, pct: ((f - b) / b) * 100 });
  }
  return out;
}

const f = (n: number | null | undefined, d = 1): string =>
  n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : n.toFixed(d);

export function targets(results: BenchResult[]): TargetRow[] {
  const big = results.find((r) => r.size === '100k');
  const rows: TargetRow[] = [];
  const limit = (name: string, metric: string, ms: number) => {
    const m = big?.metrics[metric];
    rows.push(
      m
        ? {
            target: name,
            verdict: m.summary.p95 < ms ? 'PASS' : 'FAIL',
            measured: `p95 ${f(m.summary.p95)} ms (p50 ${f(m.summary.p50)}, p99 ${f(m.summary.p99)}, n=${m.summary.n})`,
          }
        : { target: name, verdict: 'NOT RUN', measured: '100k not run' },
    );
  };
  limit('Search p95 < 100 ms at 100k notes (all 200 queries)', 'search', 100);
  const common = big?.searchByCategory['common'];
  rows.push(
    common
      ? {
          target:
            'Search p95 < 100 ms at 100k, most-common-term queries only (informational slice)',
          verdict: common.p95 < 100 ? 'PASS' : 'FAIL',
          measured: `p95 ${f(common.p95)} ms`,
        }
      : { target: 'Search, common terms only', verdict: 'NOT RUN', measured: '100k not run' },
  );
  limit('Note open (notes.get) p95 < 100 ms at 100k', 'noteOpen', 100);
  const w = big?.metrics['open.warm.spawnToReady'];
  rows.push({
    target: 'Warm start < 1 s (process spawn to list rendered)',
    verdict: 'NEEDS USER',
    measured: `needs user: Electron. Core only, for reference: spawn to workspace ready p50 ${f(w?.summary.p50, 0)} ms, openWorkspace p50 ${f(big?.metrics['open.warm.openWorkspace']?.summary.p50, 0)} ms`,
  });
  return rows;
}

const SCALING: [string, (r: BenchResult) => string][] = [
  ['Notes', (r) => String(r.notes)],
  ['DB file (MB)', (r) => f(r.scalars.dbFileMB as number)],
  ['FTS index (MB)', (r) => f(r.scalars.indexMB as number)],
  ['WAL file at end (MB)', (r) => f(r.scalars.walFileMB as number)],
  ['Open: spawn to ready p50 / p95 (ms)', (r) => pair(r, 'open.warm.spawnToReady')],
  ['Open: openWorkspace only p50 / p95 (ms)', (r) => pair(r, 'open.warm.openWorkspace')],
  ['Search p50 / p95 / p99 (ms)', (r) => trio(r, 'search')],
  ['Note open p50 / p95 / p99 (ms)', (r) => trio(r, 'noteOpen')],
  ['Autosave 1.5 KB p50 / p95 / p99 (ms)', (r) => trio(r, 'autosave.1_5k')],
  ['Autosave 50 KB p50 / p95 / p99 (ms)', (r) => trio(r, 'autosave.50k')],
  ['Tag rename (500), per op p50 / p95 (ms)', (r) => pair(r, 'tagOps.rename')],
  ['Tag merge, per op p50 / p95 (ms)', (r) => pair(r, 'tagOps.merge')],
  [
    '1,000 tag renames/merges, total (ms)',
    (r) =>
      `${f(r.scalars.tagOps1000TotalMs as number, 0)}${r.scalars.tagOps1000Estimated === 'no' ? '' : ` (estimated: ${r.scalars.tagMergesRun} of 500 merges run)`}`,
  ],
  [
    'Rename of the most-used tag (members, ms)',
    (r) => `${r.scalars.bigTagMembers ?? 'n/a'}, ${f(r.scalars.bigTagRenameMs as number, 0)}`,
  ],
  [
    'FTS optimize after autosaves (ms)',
    (r) => f(r.scalars.ftsOptimizeAfterAutosaveMs as number, 0),
  ],
  [
    'Full rebuild: total (ms) / worst slice (ms) / slices',
    (r) =>
      r.scalars.rebuildTotalMs === undefined
        ? 'not run'
        : `${f(r.scalars.rebuildTotalMs as number, 0)} / ${f(r.scalars.rebuildWorstSliceMs as number, 0)} / ${r.scalars.rebuildSlices}`,
  ],
  [
    'RSS idle / after searches (MB)',
    (r) => `${f(r.scalars.rssIdleMB as number, 0)} / ${f(r.scalars.rssAfterSearchMB as number, 0)}`,
  ],
];
function pair(r: BenchResult, k: string): string {
  const s = r.metrics[k]?.summary;
  return s ? `${f(s.p50, 2)} / ${f(s.p95, 2)}` : 'n/a';
}
function trio(r: BenchResult, k: string): string {
  const s = r.metrics[k]?.summary;
  return s ? `${f(s.p50, 2)} / ${f(s.p95, 2)} / ${f(s.p99, 2)}` : 'n/a';
}

function failures(results: BenchResult[]): string[] {
  const big = results.find((r) => r.size === '100k');
  const out: string[] = [];
  const s = big?.metrics['search'];
  if (big && s && s.summary.p95 >= 100) {
    const c = big.searchByCategory['common'];
    const slow = big.slowestQueries
      .map((q) => `\`${q.query}\` (${f(q.ms)} ms, ${q.hits} hits shown)`)
      .join(', ');
    out.push(
      `**Search p95 is ${f(s.summary.p95)} ms at 100k (target 100 ms).** Slowest queries by p50: ${slow}. Common-term queries p95 ${f(c?.p95)} ms.`,
      '  - Suspected cause: cost is linear in the number of matching notes. `createSearch` (`packages/core/src/search/search.ts`) builds a MATERIALIZED CTE that joins every FTS hit to `search_doc` and `notes` and sorts all of them before `LIMIT`; the most common terms ("the", "of", "and") match most notes. An ad hoc check at 10k notes (not part of the harness) gave 18 ms for `ORDER BY rank LIMIT 50` on the FTS table alone against about 125 ms for the same query through `search.search`.',
      '  - Next steps: (1) with no filters, take the top N rowids by `ORDER BY rank LIMIT N` first and join only those rows; with filters, apply them as a rowid pre-filter; (2) cap ranked matches and show a "refine your search" notice; (3) demote very frequent terms when the query has other terms (stop-word handling). Re-run `npm run bench` after each.',
    );
  }
  const a50 = big?.metrics['autosave.50k'];
  const a15 = big?.metrics['autosave.1_5k'];
  if (
    a15 &&
    a50 &&
    (a15.summary.p99 > 10 * a15.summary.p50 || a50.summary.p99 > 10 * a50.summary.p50)
  )
    out.push(
      `**Autosave tail is long** (1.5 KB p50/p99 ${f(a15.summary.p50)}/${f(a15.summary.p99)} ms; 50 KB ${f(a50.summary.p50)}/${f(a50.summary.p99)} ms).`,
      '  - Suspected cause: FTS5 segment merges (automerge) and per-save version snapshots, plus the fullfsync on every commit on macOS.',
      '  - Next steps: lower `automerge`/`crisismerge` pressure with a larger `usermerge`, run `merge` in idle slices, or debounce saves.',
    );
  const ow = big?.metrics['open.warm.openWorkspace'];
  if (ow && ow.summary.p50 > 1000)
    out.push(
      `**Warm workspace open is already ${f(ow.summary.p50, 0)} ms (p50) in core alone at 100k**, before Electron starts, so the 1 s warm-start goal cannot be met as is.`,
      '  - Suspected cause: the startup integrity check (`quick_check` over the whole database) is O(database size).',
      '  - Next steps: open with a cheap check (header, `application_id`, the lock) and run `quick_check` in the background after the list renders, or only after an unclean shutdown.',
    );
  const mg = big?.metrics['tagOps.merge'];
  if (mg && mg.summary.p50 > 1000)
    out.push(
      `**A tag merge takes ${f(mg.summary.p50, 0)} ms (p50) at 100k.** Every merge ends with the FTS \`optimize\` plus \`wal_checkpoint(TRUNCATE)\` (\`afterPurge\`), which is O(index size).`,
      '  - Next steps: run `afterPurge` once per batch or off the UI path, and have bulk merges (many tags) call it once at the end.',
    );
  const opt = big?.scalars.ftsOptimizeAfterAutosaveMs;
  if (typeof opt === 'number' && opt > 250)
    out.push(
      `**FTS \`optimize\` after purge/tag-merge takes ${f(opt, 0)} ms at 100k** (the spike saw 0.3 s at 20k). Run it off the UI path or only when a purged term could remain.`,
    );
  const t = big?.scalars.bigTagRenameMs;
  if (typeof t === 'number' && t > 1000)
    out.push(
      `**Renaming the most-used tag took ${f(t, 0)} ms** (${big?.scalars.bigTagMembers} notes): every member's search_doc and index row is rewritten in one transaction. Next step: chunk it or show progress.`,
    );
  const w = big?.scalars.rebuildWorstSliceMs;
  if (typeof w === 'number' && w > 200)
    out.push(
      `**Rebuild worst slice ${f(w, 0)} ms** blocks the event loop longer than one frame budget; consider a smaller slice size.`,
    );
  return out;
}

export function renderReport(results: BenchResult[]): string {
  const rs = [...results].sort((a, b) => a.notes - b.notes);
  const env = (rs[rs.length - 1] as BenchResult | undefined)?.env;
  const L: string[] = [];
  L.push(
    '# Benchmarks',
    '',
    '<!-- Generated by `npm run bench` (packages/bench). Do not edit by hand. -->',
    '',
    'Targets are provisional goals, not claims. A target is reported PASS only with a run behind it. Every number below comes from `packages/bench/results/<size>.json` (raw samples included).',
    '',
    '## Targets',
    '',
    '| Target | Verdict | Measured |',
    '|---|---|---|',
    ...targets(rs).map((t) => `| ${t.target} | **${t.verdict}** | ${t.measured} |`),
    '',
  );
  const fl = failures(rs);
  if (fl.length)
    L.push(
      '### Failures: suspected causes and next steps',
      '',
      ...fl.map((x) => (x.startsWith('  ') ? x : `- ${x}`)),
      '',
    );
  L.push('## Hardware and software', '');
  if (env)
    L.push(
      `- CPU: ${env.cpu}, ${env.cores} cores; RAM: ${env.memoryGB} GB`,
      `- OS: ${env.os}`,
      `- Node: ${env.node}; SQLite: ${env.sqlite} (better-sqlite3); Electron: not launched by this harness`,
      `- Commit: ${env.commit ?? 'unknown (not a git checkout)'}`,
    );
  L.push(
    '',
    'Reference machine in the spec: Apple M2, 8 cores, 8 GB, macOS 27.0.1. Other hardware classes are untested.',
    '',
  );
  L.push(
    '## Datasets',
    '',
    '| Size | Notes | Trashed | Folders | Tags | Body text (MB) | Median / p99 body (bytes) | Seed | Logical hash (sha256) | Generation (s) |',
    '|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const r of rs)
    L.push(
      `| ${r.size} | ${r.notes} | ${r.scalars.trashedNotes} | ${r.scalars.folders} | ${r.scalars.tags} | ${f(r.scalars.noteBodyMB as number)} | ${r.scalars.bodyMedianBytes} / ${r.scalars.bodyP99Bytes} | ${r.seed} | \`${r.datasetHash.slice(0, 16)}\` | ${f(r.generateSeconds, 0)} |`,
    );
  L.push(
    '',
    'Generated by `packages/bench/src/dataset.ts` through the real core APIs (`folders.create`, `notes.create`, `tags.tagNote`, `notes.setFavorite`, `trash.trashNote`), so every search trigger fires. Sizes are lognormal (median about 1.5 KB, p99 about 50 KB), words are Zipf over a 20,000-word vocabulary with phrases, headings, lists, checklists, markdown links and `[[wikilinks]]`; about 2% of notes are trashed, 3% favorites, 0 to 4 tags per note over 300 tags, folders up to 5 levels deep. During generation only (not the timed runs) `synchronous=OFF` is used. The hash covers ordered notes, folder paths and tag names, not random ids.',
    '',
    '**The `.bench-data/` folder holds the generated databases (about 1.8 GB at 100k) and must be gitignored.**',
    '',
    '## Scaling (PB-5)',
    '',
    `| Metric | ${rs.map((r) => r.size).join(' | ')} |`,
    `|---|${rs.map(() => '---').join('|')}|`,
    ...SCALING.map(([n, g]) => `| ${n} | ${rs.map(g).join(' | ')} |`),
    '',
  );
  L.push(
    '### Search by query category (p50 / p95 ms)',
    '',
    `| Category | ${rs.map((r) => r.size).join(' | ')} |`,
    `|---|${rs.map(() => '---').join('|')}|`,
  );
  for (const c of CATEGORIES)
    L.push(
      `| ${c} | ${rs
        .map((r) => {
          const s = r.searchByCategory[c];
          return s ? `${f(s.p50, 2)} / ${f(s.p95, 2)}` : 'n/a';
        })
        .join(' | ')} |`,
    );
  L.push('', '### Slowest queries (median ms, hits on first page)', '');
  for (const r of rs)
    L.push(
      `- ${r.size}: ${r.slowestQueries.map((q) => `\`${q.query}\` ${f(q.ms)} ms / ${q.hits}`).join('; ')}`,
    );
  const hooks = rs.flatMap((r) =>
    Object.entries(r.metrics)
      .filter(([k]) => k.startsWith('hook.'))
      .map(
        ([k, m]) =>
          `| ${r.size} | ${k.slice(5)} | ${f(m.summary.p50, 2)} | ${f(m.summary.p95, 2)} | ${m.targetP95Ms === undefined ? 'none' : m.summary.p95 < m.targetP95Ms ? `PASS (< ${m.targetP95Ms})` : `FAIL (< ${m.targetP95Ms})`} |`,
      ),
  );
  if (hooks.length)
    L.push(
      '',
      '## Metrics from other modules (PB-7)',
      '',
      '| Size | Metric | p50 ms | p95 ms | Verdict |',
      '|---|---|---|---|---|',
      ...hooks,
    );
  L.push(
    '',
    '## Method',
    '',
    '- Search: the fixed 200-query set (`src/queries.ts`: 1 term, 2-3 terms, rare, very common, prefix, phrase, with tag/folder/date filters, exclusion) goes through `dispatcher.handle("search.run")`; one unmeasured pass, then 3 measured passes (600 samples; 1 in quick mode). Default page size 50.',
    '- Note open: 300 random live notes via `dispatcher.handle("notes.get")`. Autosave: `notes.save` through the dispatcher with the compare-and-set hash, 200 saves each on 1.5 KB and 50 KB bodies of random notes, production durability (WAL, synchronous=FULL, fullfsync on macOS).',
    '- Tags: 1,000 fresh tags (5 notes each), then 500 renames and 500 merges (`confirmMerge`) timed one by one.',
    '- Open: 30 separate Node processes after one unmeasured spawn; both spawn-to-ready wall time (includes Node boot and TypeScript stripping) and `openWorkspace` alone (lock, migrations check, integrity check).',
    '- Every run measures a fresh copy of the cached dataset. RSS is this harness process (it also holds the harness itself), not Electron.',
    '',
    '## Warm and cold start (PB-6)',
    '',
    '- **Warm start**: the second launch with a warm OS file cache, measured from process spawn to the main window\'s "list rendered" event.',
    '- **Cold start**: the first launch after a reboot or cache purge (`sudo purge`), reported separately.',
    '- This harness cannot launch Electron here, so the UI numbers are not measured. The core-only numbers above are the lower bound of the real number.',
    '',
    '## Limitations',
    '',
    '- Not measured, needs the user (Electron, outside the Claude sandbox): app start to list rendered (warm and cold) and opening a note in the editor UI. Note-open above is `notes.get` only (no rendering, no IPC).',
    '- Cold open needs root (`sudo purge`) or a reboot; see the notes below for whether it ran.',
    '- Synthetic text: the Zipf vocabulary approximates real prose; real notes with unusual token distributions can differ.',
    '- One machine, one run per size. Differences below the noise floor are not regressions.',
    '',
    '## Not run',
    '',
    ...[...new Set(rs.flatMap((r) => r.notRun))].map((x) => `- ${x}`),
    ...['1k', '10k', '100k']
      .filter((s) => !rs.some((r) => r.size === s))
      .map((s) => `- Dataset ${s}: not run`),
    '',
    '## Regression check (PB-4)',
    '',
    "`npm run bench:check` runs a fresh quick 10k pass and compares each metric's p95 to `packages/bench/baseline.json`; it fails when any p95 grew by more than 20% and by more than 0.5 ms (timer noise). Update the baseline deliberately with `npm run bench:quick -- --update-baseline`.",
    '',
  );
  return L.join('\n');
}
