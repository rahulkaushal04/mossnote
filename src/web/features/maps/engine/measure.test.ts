import { describe, expect, it } from 'vitest';
import { outlineLength, polygonArea } from './measure';

describe('measure', () => {
  it('computes the area of a rectangle and a triangle', () => {
    expect(
      polygonArea([
        [0, 0],
        [10, 0],
        [10, 5],
        [0, 5],
      ]),
    ).toBe(50);
    expect(
      polygonArea([
        [0, 0],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(50);
  });
  it('does not care which way round the corners go', () => {
    expect(
      polygonArea([
        [0, 0],
        [0, 5],
        [10, 5],
        [10, 0],
      ]),
    ).toBe(50);
  });
  it('measures outline length, closed or open', () => {
    expect(
      outlineLength(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        false,
      ),
    ).toBe(20);
    expect(
      outlineLength(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        true,
      ),
    ).toBeCloseTo(20 + Math.SQRT2 * 10, 5);
  });
});
