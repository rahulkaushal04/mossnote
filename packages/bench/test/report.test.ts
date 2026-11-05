import { describe, expect, it } from 'vitest';
import type { BenchResult } from '../src/harness.ts';
import { clearMetrics, registeredMetrics, registerMetric } from '../src/hooks.ts';
import { buildQuerySet, CATEGORIES, QUERY_COUNT } from '../src/queries.ts';
import { compare, renderReport, toBaseline } from '../src/report.ts';
import { summarize } from '../src/stats.ts';

const m = (p95: number) => ({
  unit: 'ms' as const,
  samples: [p95],
  summary: { ...summarize([p95]), n: 30 },
});

function fake(size: '10k' | '100k', searchP95: number, noteOpenP95 = 2): BenchResult {
  return {
    schema: 1,
    size,
    notes: size === '10k' ? 10_000 : 100_000,
    seed: 1,
    datasetHash: 'abcdef0123456789abcdef',
    generateSeconds: 5,
    quick: false,
    startedAt: '2026-01-01T00:00:00Z',
    env: {
      cpu: 'Apple M2',
      cores: 8,
      memoryGB: 8,
      os: 'macOS test',
      node: 'v22',
      sqlite: '3.53.4',
      electron: null,
      commit: 'abc1234',
    },
    metrics: {
      search: m(searchP95),
      noteOpen: m(noteOpenP95),
      'open.warm.spawnToReady': m(400),
      'autosave.1_5k': m(5),
    },
    searchByCategory: { common: summarize([searchP95]) },
    slowestQueries: [{ query: 'the of', category: 'common', ms: searchP95, hits: 50 }],
    scalars: { dbFileMB: 10, indexMB: 5 },
    notRun: ['UI start time: needs Electron'],
  };
}

describe('query set (PB-2)', () => {
  const qs = buildQuerySet();
  it('has exactly 200 queries covering every category, and is fixed', () => {
    expect(qs).toHaveLength(QUERY_COUNT);
    for (const c of CATEGORIES) expect(qs.some((q) => q.category === c)).toBe(true);
    expect(buildQuerySet()).toEqual(qs);
  });
  it('uses the syntax each category claims', () => {
    expect(qs.filter((q) => q.category === 'prefix').every((q) => q.query.endsWith('*'))).toBe(
      true,
    );
    expect(qs.filter((q) => q.category === 'phrase').every((q) => /^".+"$/.test(q.query))).toBe(
      true,
    );
    expect(qs.filter((q) => q.category === 'exclude').every((q) => / -\w+/.test(q.query))).toBe(
      true,
    );
    expect(qs.filter((q) => q.category === 'tag').every((q) => !!q.tag)).toBe(true);
    expect(qs.filter((q) => q.category === 'folder').every((q) => q.folder !== undefined)).toBe(
      true,
    );
    expect(
      qs.filter((q) => q.category === 'date').every((q) => q.createdFrom! < q.createdTo!),
    ).toBe(true);
  });
});

describe('report (PB-3)', () => {
  it('PASS when targets are met, and never claims the warm start', () => {
    const md = renderReport([fake('10k', 3), fake('100k', 40)]);
    expect(md).toMatch(/Search p95 < 100 ms at 100k notes[^\n]*\*\*PASS\*\*/);
    expect(md).toMatch(/Warm start < 1 s[^\n]*\*\*NEEDS USER\*\*[^\n]*needs user: Electron/);
    expect(md).toContain('Apple M2');
    expect(md).toContain('abc1234');
    expect(md).toContain('.bench-data/');
    expect(md).toContain('Scaling (PB-5)');
  });
  it('FAIL lists suspected causes and next steps', () => {
    const md = renderReport([fake('100k', 250)]);
    expect(md).toMatch(/Search p95 < 100 ms at 100k notes[^\n]*\*\*FAIL\*\*/);
    expect(md).toContain('Suspected cause');
    expect(md).toContain('Next steps');
  });
  it('says NOT RUN without a 100k result', () => {
    expect(renderReport([fake('10k', 3)])).toMatch(/at 100k notes[^\n]*\*\*NOT RUN\*\*/);
  });
});

describe('baseline comparison (PB-4)', () => {
  const base = toBaseline(fake('10k', 20));
  it('fails on an injected 30% p95 regression', () => {
    const bad = compare(base, fake('10k', 26));
    expect(bad.map((b) => b.metric)).toEqual(['search']);
    expect(bad[0]?.pct).toBeCloseTo(30);
  });
  it('passes at +10% and on improvements', () => {
    expect(compare(base, fake('10k', 22))).toEqual([]);
    expect(compare(base, fake('10k', 5))).toEqual([]);
  });
  it('ignores sub-noise-floor changes on tiny numbers', () => {
    expect(compare(toBaseline(fake('10k', 3, 0.1)), fake('10k', 3, 0.3))).toEqual([]);
  });
});

describe('module hooks (PB-7)', () => {
  it('registers metrics once and lists them', () => {
    clearMetrics();
    registerMetric({ id: 'links.backlinks', title: 'x', targetP95Ms: 50, run: () => 1 });
    expect(registeredMetrics().map((h) => h.id)).toEqual(['links.backlinks']);
    expect(() => registerMetric({ id: 'links.backlinks', title: 'y', run: () => 2 })).toThrow(
      /already/,
    );
    clearMetrics();
  });
  it('hook results render with a verdict', () => {
    const r = fake('10k', 3);
    r.metrics['hook.links.backlinks'] = { ...m(70), targetP95Ms: 50 };
    expect(renderReport([r])).toMatch(/links\.backlinks \| [\d.]+ \| 70\.00 \| FAIL/);
  });
});
