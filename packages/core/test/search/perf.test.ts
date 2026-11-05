import { performance } from 'node:perf_hooks';
import { describe, it } from 'vitest';
import { createSearchApi } from '../../src/search/index.ts';
import { sha256 } from '../../src/db/hash.ts';
import { openWs, unwrap } from './util.ts';

// Measurement, not a gate: run with SEARCH_PERF=1 (numbers go to stderr). Skipped in `npm run check`.
const N = Number(process.env['SEARCH_PERF_NOTES'] ?? 10_000);

function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)]!;

describe.skipIf(!process.env['SEARCH_PERF'])('search latency at scale', () => {
  it(`${N} notes`, () => {
    const r = rng(7);
    const words = Array.from({ length: 5000 }, (_, i) => `w${i.toString(36)}x${i % 97}`);
    const zipf = () => words[Math.floor(5000 * r() ** 3)]!; // heavy head, long tail
    const { w } = openWs({ wrapDb: (d) => (d.pragma('synchronous = OFF'), d) });
    const db = w.store.db;
    const ins = db.prepare(
      'INSERT INTO notes(id, folder_id, title, body, content_hash, rev, favorite, created_at, updated_at, device_id) VALUES (?,NULL,?,?,?,1,0,?,?,?)',
    );
    const t0 = performance.now();
    db.exec('BEGIN');
    for (let i = 0; i < N; i++) {
      const len = Math.floor(30 * Math.exp(r() * 3)); // ~30..600 words, median ~ 150
      const body = Array.from({ length: len }, zipf).join(' ');
      ins.run(
        `01HF7YAT00${String(i).padStart(16, '0')}`,
        `${zipf()} ${zipf()} ${zipf()}`,
        body,
        sha256(body),
        i,
        i,
        'D',
      );
    }
    db.exec('COMMIT');
    const loadMs = performance.now() - t0;
    process.stderr.write(`PERF load ${N} notes with triggers: ${loadMs.toFixed(0)} ms\n`);

    const queries: string[] = [];
    for (let i = 0; i < 200; i++) {
      const k = 1 + (i % 3);
      queries.push(Array.from({ length: k }, zipf).join(' '));
    }
    for (const q of queries.slice(0, 20)) unwrap(w.search.search({ query: q })); // warm
    const lat: number[] = [];
    for (let rep = 0; rep < 3; rep++)
      for (const q of queries) {
        const t = performance.now();
        unwrap(w.search.search({ query: q, limit: 50 }));
        lat.push(performance.now() - t);
      }
    const common = performance.now();
    unwrap(w.search.search({ query: words[0]! }));
    process.stderr.write(
      `PERF query p50 ${pct(lat, 0.5).toFixed(1)} ms, p95 ${pct(lat, 0.95).toFixed(1)} ms, p99 ${pct(lat, 0.99).toFixed(1)} ms, most common term ${(performance.now() - common).toFixed(1)} ms\n`,
    );

    // Rebuild: worst blocking slice and total.
    const api = createSearchApi(w.store);
    unwrap(api.markDirty('perf'));
    const slices: number[] = [];
    const tr = performance.now();
    for (;;) {
      const t = performance.now();
      const s = unwrap(api.rebuildStep());
      slices.push(performance.now() - t);
      if (s.done) break;
    }
    process.stderr.write(
      `PERF rebuild total ${(performance.now() - tr).toFixed(0)} ms in ${slices.length} steps, worst step ${Math.max(...slices).toFixed(0)} ms, p50 ${pct(slices, 0.5).toFixed(0)} ms\n`,
    );

    // Autosave cost with durability on, with the index and (as a baseline) without it.
    db.pragma('synchronous = FULL');
    const id = (db.prepare('SELECT id FROM notes LIMIT 1 OFFSET 5000').get() as { id: string }).id;
    for (const indexed of [true, false]) {
      if (!indexed) unwrap(api.markDirty('baseline: triggers off'));
      for (const [label, size] of [
        ['1.5 KB', 1500],
        ['50 KB', 50_000],
      ] as const) {
        const times: number[] = [];
        for (let i = 0; i < 30; i++) {
          const body = Array.from({ length: Math.floor(size / 6) }, zipf).join(' ');
          const t = performance.now();
          unwrap(w.notes.save({}, id, { title: 't', body }));
          times.push(performance.now() - t);
        }
        process.stderr.write(
          `PERF autosave ${label} ${indexed ? 'WITH index' : 'baseline (no index)'}: p50 ${pct(times, 0.5).toFixed(1)} ms, p95 ${pct(times, 0.95).toFixed(1)} ms\n`,
        );
      }
    }
  }, 600_000);
});
