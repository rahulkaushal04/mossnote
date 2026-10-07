import { describe, expect, it } from 'vitest';
import { placeLabels } from './labels';

describe('placeLabels', () => {
  it('puts a lone label below its pin', () => {
    expect(placeLabels([{ id: 'a', x: 100, y: 100, w: 60 }]).get('a')?.side).toBe('below');
  });
  it('moves a label above when another pin sits below it', () => {
    const out = placeLabels([
      { id: 'a', x: 100, y: 100, w: 60 },
      { id: 'b', x: 100, y: 124, w: 60 },
    ]);
    expect(out.get('a')?.side).toBe('above');
    expect(out.get('b')?.side).toBe('below');
  });
  it('uses the sides when above and below are taken', () => {
    const out = placeLabels([
      { id: 'a', x: 100, y: 100, w: 40 },
      { id: 'b', x: 100, y: 128, w: 40 },
      { id: 'c', x: 100, y: 72, w: 40 },
    ]);
    expect(out.get('a')?.side).toBe('right');
  });
  it('never returns nothing: crowded labels still get a place', () => {
    const crowd = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      x: 100 + (i % 3) * 8,
      y: 100 + (i % 4) * 8,
      w: 80,
    }));
    expect(placeLabels(crowd).size).toBe(12);
  });
});
