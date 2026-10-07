import { describe, expect, it } from 'vitest';
import { allowedEdits, boundedDistance } from './editDistance';

describe('boundedDistance', () => {
  it('counts insertions, deletions, substitutions and adjacent transpositions as one edit', () => {
    expect(boundedDistance('harbour', 'harbour', 2)).toBe(0);
    expect(boundedDistance('harbour', 'harbor', 2)).toBe(1);
    expect(boundedDistance('harbour', 'harbours', 2)).toBe(1);
    expect(boundedDistance('harbour', 'harbaur', 2)).toBe(1);
    expect(boundedDistance('harbuor', 'harbour', 2)).toBe(1);
    expect(boundedDistance('abcd', 'acbd', 2)).toBe(1);
  });

  it('reports more than max as max + 1', () => {
    expect(boundedDistance('lantern', 'harbour', 2)).toBe(3);
    expect(boundedDistance('a', 'abcdef', 2)).toBe(3);
    expect(boundedDistance('abcdefgh', 'zzzzzzzz', 1)).toBe(2);
  });

  it('handles empty strings', () => {
    expect(boundedDistance('', '', 2)).toBe(0);
    expect(boundedDistance('', 'ab', 2)).toBe(2);
    expect(boundedDistance('abc', '', 2)).toBe(3);
  });

  it('matches a full Damerau-Levenshtein reference on random short words', () => {
    const reference = (a: string, b: string): number => {
      const d: number[][] = Array.from({ length: a.length + 1 }, () =>
        new Array<number>(b.length + 1).fill(0),
      );
      for (let i = 0; i <= a.length; i++) d[i]![0] = i;
      for (let j = 0; j <= b.length; j++) d[0]![j] = j;
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          let v = Math.min(
            (d[i - 1]![j] ?? 0) + 1,
            (d[i]![j - 1] ?? 0) + 1,
            (d[i - 1]![j - 1] ?? 0) + cost,
          );
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
            v = Math.min(v, (d[i - 2]![j - 2] ?? 0) + 1);
          }
          d[i]![j] = v;
        }
      }
      return d[a.length]![b.length] ?? 0;
    };
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const word = () =>
      Array.from({ length: 1 + Math.floor(rand() * 7) }, () => 'abc'[Math.floor(rand() * 3)]).join(
        '',
      );
    for (let i = 0; i < 400; i++) {
      const a = word();
      const b = word();
      const max = 2;
      expect(boundedDistance(a, b, max), `${a} ${b}`).toBe(Math.min(reference(a, b), max + 1));
    }
  });

  it('scans 30,000 terms well inside the budget', () => {
    const terms = Array.from({ length: 30_000 }, (_, i) => `term${i.toString(36)}word`);
    const started = Date.now();
    let hits = 0;
    for (const t of terms) if (boundedDistance('termzzword', t, 2) <= 2) hits++;
    expect(Date.now() - started).toBeLessThan(100);
    expect(hits).toBeGreaterThanOrEqual(0);
  });
});

describe('allowedEdits', () => {
  it('never fuzzes under 4 characters, 1 edit for 4 to 7, 2 for 8 or more', () => {
    expect(allowedEdits('abc')).toBe(0);
    expect(allowedEdits('abcd')).toBe(1);
    expect(allowedEdits('abcdefg')).toBe(1);
    expect(allowedEdits('abcdefgh')).toBe(2);
  });
});
