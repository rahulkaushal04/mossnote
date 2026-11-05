import { describe, expect, it } from 'vitest';
import { sweep, type SweepStats } from './harness.ts';
import { SCENARIOS } from './scenarios.ts';

/** CS-8: a fault at every statement (pre- and after-effect) of every mutation leaves the committed state intact. */
describe('CS-8 statement-level fault sweep', () => {
  const stats: SweepStats = { combos: 0 };
  for (const sc of SCENARIOS)
    it(sc.name, { timeout: 300_000 }, () => {
      expect(sweep(sc, stats)).toEqual([]);
    });
  it('exercised a meaningful number of combinations', () => {
    console.log(`fault sweep combinations: ${stats.combos}`);
    expect(stats.combos).toBeGreaterThan(1000);
  });
});
