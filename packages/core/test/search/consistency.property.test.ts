import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { caseArb, runCase, type Stats } from './consistency.ts';

const RUNS = 1000;
const run = (numRuns: number, mutant?: Parameters<typeof runCase>[2], seed?: number) => {
  const stats: Stats = { queries: 0, nonEmpty: 0, runs: 0 };
  const go = () =>
    fc.assert(
      fc.property(caseArb, (c) => {
        const failure = runCase(c, stats, mutant);
        if (failure) throw new Error(failure); // reported by fast-check; no expect() inside the callback
      }),
      { numRuns, endOnFailure: true, seed },
    );
  return { go, stats };
};

describe('SR-2 index == brute force after random writes', () => {
  it(`${RUNS} runs: tags, trash/restore, folder trash, purge, version restore, applyRemote, REPLACE/IGNORE/UPSERT`, () => {
    const t = run(RUNS);
    t.go();
    expect(t.stats.runs).toBe(RUNS);
    // Terms come from the corpus, so most queries must have hits (an all-empty oracle proves nothing).
    expect(t.stats.queries).toBeGreaterThan(RUNS);
    expect(t.stats.nonEmpty / t.stats.queries).toBeGreaterThan(0.4);
  }, 600_000);
});

describe('mutation checks: the property test notices a broken index', () => {
  const sabotage: Record<string, Parameters<typeof runCase>[2]> = {
    'trigger: note_tags insert no longer reindexes tags': (w) =>
      w.store.db.exec('DROP TRIGGER search_nt_ai'),
    'trigger: note_tags UPDATE no longer reindexes tags': (w) =>
      w.store.db.exec('DROP TRIGGER search_nt_au'),
    'trigger: tag rename no longer reindexes': (w) =>
      w.store.db.exec('DROP TRIGGER search_tags_au'),
    'trigger: INSERT OR REPLACE stash removed': (w) =>
      w.store.db.exec('DROP TRIGGER search_notes_bi'),
    'trigger: note delete no longer removes index rows': (w) =>
      w.store.db.exec('DROP TRIGGER search_notes_bd'),
    'tokenizer: remove_diacritics 0': (w) =>
      w.store.db.exec(`DROP TABLE note_fts;
        CREATE VIRTUAL TABLE note_fts USING fts5(title, body, tags, att, content='search_src', content_rowid='rid',
          tokenize='unicode61 remove_diacritics 0', prefix='2 3');`),
  };
  it.each(Object.keys(sabotage))(
    '%s',
    (name) => {
      const t = run(500, sabotage[name], 42);
      expect(t.go).toThrow();
    },
    120_000,
  );
});
