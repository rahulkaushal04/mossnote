import { describe, expect, it } from 'vitest';
import { countFor } from './nav';

const counts = { notes: 12, people: 4, plantings: 2, maps: 1 };

describe('countFor', () => {
  it('maps each section to the matching journal count', () => {
    expect(countFor('journal', counts)).toBe(12);
    expect(countFor('people', counts)).toBe(4);
    expect(countFor('farm', counts)).toBe(2);
    expect(countFor('maps', counts)).toBe(1);
  });

  it('has no count for Today, and none before the counts load', () => {
    expect(countFor('today', counts)).toBeNull();
    expect(countFor('people', undefined)).toBeNull();
  });
});
