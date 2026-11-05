import { describe, expect, it } from 'vitest';
import { fuzzyScore } from '../src/commands/fuzzy';

describe('fuzzyScore', () => {
  it('requires a subsequence and ignores case and spaces', () => {
    expect(fuzzyScore('nn', 'New note')).not.toBeNull();
    expect(fuzzyScore('xz', 'New note')).toBeNull();
    expect(fuzzyScore('NEW N', 'new note')).not.toBeNull();
    expect(fuzzyScore('ton', 'note')).toBeNull(); // order matters
  });
  it('ranks start, word boundary and consecutive matches higher', () => {
    const s = (q: string, t: string) => fuzzyScore(q, t)!;
    expect(s('not', 'Note')).toBeGreaterThan(s('not', 'Another')); // start beats middle
    expect(s('tr', 'Move Trash')).toBeGreaterThan(s('tr', 'Control'));
    expect(s('bl', 'Blur')).toBeGreaterThan(s('bl', 'Able'));
  });
  it('empty query matches everything', () => {
    expect(fuzzyScore('', 'anything')).not.toBeNull();
  });
});
