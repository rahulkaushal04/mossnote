import { describe, expect, it } from 'vitest';
import { sweep, type Scenario, type SweepStats } from './harness.ts';
import { SCENARIOS } from './scenarios.ts';

const stats = (): SweepStats => ({ combos: 0 });

/**
 * The sweep must be able to fail. These scenarios are deliberately broken the way a real bug
 * would be, and the sweep has to report violations for each (and none for the sound baseline).
 */
describe(
  'CS-8 sweep sensitivity (the sweep fails on broken mutations)',
  { timeout: 120_000 },
  () => {
    const sound = SCENARIOS.find((s) => s.name === 'notes.create')!;

    it('baseline: the sound mutation is clean', () => {
      expect(sweep(sound, stats())).toEqual([]);
    });

    it('detects a write made outside the transaction', () => {
      const leaky: Scenario = {
        name: 'leaky: autocommit write before the tx',
        op: (c) => {
          // Goes through the same Db but not through mutate(): commits immediately.
          c.w.store.db
            .prepare(
              "INSERT INTO meta(key, value) VALUES ('leak', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .run(String(c.clock.t));
          return sound.op(c);
        },
      };
      const v = sweep(leaky, stats());
      expect(v.length).toBeGreaterThan(0);
      expect(v.some((x) => x.includes('dump changed'))).toBe(true);
    });

    it('detects a mutation split across two transactions', () => {
      const split: Scenario = {
        name: 'split: two commits for one action',
        op: (c) => {
          const a = c.w.notes.create({}, { title: 'half', body: 'a' });
          return a.ok ? c.w.folders.create({}, { name: 'other half' }) : a;
        },
      };
      const v = sweep(split, stats());
      expect(v.length).toBeGreaterThan(0);
      expect(v.some((x) => x.includes('dump changed'))).toBe(true);
    });

    it('detects an error that is swallowed (op reports success despite the fault)', () => {
      const swallow: Scenario = {
        name: 'swallow',
        op: (c) => {
          const r = sound.op(c);
          return r.ok ? r : { ok: true, value: null };
        },
      };
      expect(sweep(swallow, stats()).some((x) => x.includes('reported success'))).toBe(true);
    });

    it('detects a thrown exception instead of a typed AppError', () => {
      const thrower: Scenario = {
        name: 'thrower',
        op: (c) => {
          const r = sound.op(c);
          if (!r.ok) throw new Error(r.error.message);
          return r;
        },
      };
      expect(sweep(thrower, stats()).some((x) => x.includes('threw instead'))).toBe(true);
    });

    it('after-effect on BEGIN IMMEDIATE rolls back and leaves the connection usable', () => {
      expect(sweep(sound, stats(), { afterBegin: true })).toEqual([]);
    });
  },
);
