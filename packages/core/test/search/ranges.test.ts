import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MARK_CLOSE,
  MARK_OPEN,
  rangesFromMarked,
  stripMarkerChars,
} from '../../src/search/index.ts';

const O = MARK_OPEN;
const C = MARK_CLOSE;
const run = (s: string) => rangesFromMarked(s, O, C);

describe('rangesFromMarked', () => {
  it('extracts ranges and the clean text', () => {
    expect(run(`a ${O}bc${C} d ${O}e${C}`)).toEqual({
      text: 'a bc d e',
      ranges: [
        [2, 4],
        [7, 8],
      ],
    });
  });
  it('uses UTF-16 offsets for multi-byte text', () => {
    const r = run(`😀${O}é😀${C}日`);
    expect(r.text).toBe('😀é😀日');
    expect(r.ranges).toEqual([[2, 5]]);
  });
  it('tolerates unbalanced and nested markers', () => {
    expect(run(`a${O}b`)).toEqual({ text: 'ab', ranges: [[1, 2]] });
    expect(run(`a${C}b`)).toEqual({ text: 'ab', ranges: [] });
    expect(run(`${O}a${O}b${C}${C}c`)).toEqual({ text: 'abc', ranges: [[0, 2]] });
    expect(run(`${O}${C}x`)).toEqual({ text: 'x', ranges: [] });
  });
  it('rejects invalid marker arguments without throwing', () => {
    expect(rangesFromMarked('abc', '', C).ranges).toEqual([]);
    expect(rangesFromMarked('abc', 'ab', C).ranges).toEqual([]);
    expect(rangesFromMarked('abc', O, O).ranges).toEqual([]);
  });
  it('stripMarkerChars removes forged markers from note text', () => {
    const body = `x${O}forged${C}y`;
    const r = run(stripMarkerChars(body));
    expect(r.ranges).toEqual([]);
    expect(r.text).toBe('x forged y');
  });

  it('property: ranges are in bounds, ordered, non-overlapping, for arbitrary input', () => {
    const piece = fc.oneof(fc.string({ unit: 'binary' }), fc.constantFrom(O, C, O + O, C + C));
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 12 }), (parts) => {
        const r = run(parts.join(''));
        expect(r.text).not.toContain(O);
        expect(r.text).not.toContain(C);
        let prev = 0;
        for (const [s, e] of r.ranges) {
          expect(s).toBeGreaterThanOrEqual(prev);
          expect(e).toBeGreaterThan(s);
          expect(e).toBeLessThanOrEqual(r.text.length);
          prev = e;
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('property: well-formed input reconstructs exactly', () => {
    const plain = fc.string({ unit: 'binary' }).map(stripMarkerChars);
    const seg = fc.record({ gap: plain, hit: plain.filter((t) => t.length > 0) });
    fc.assert(
      fc.property(fc.array(seg, { maxLength: 8 }), plain, (segs, tail) => {
        const marked = segs.map((x) => `${x.gap}${O}${x.hit}${C}`).join('') + tail;
        const r = run(marked);
        let rebuilt = '';
        let pos = 0;
        for (const [s, e] of r.ranges) {
          rebuilt += r.text.slice(pos, s) + O + r.text.slice(s, e) + C;
          pos = e;
        }
        rebuilt += r.text.slice(pos);
        expect(rebuilt).toBe(marked);
        expect(r.ranges).toHaveLength(segs.length);
      }),
      { numRuns: 1000 },
    );
  });
});
