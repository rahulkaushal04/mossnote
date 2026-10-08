import { describe, expect, it } from 'vitest';
import { handleHitRadius, HANDLE_VISIBLE_RADIUS } from './handleSize';

describe('handleHitRadius', () => {
  it('is the drawn size for a mouse, where the pointer is precise', () => {
    expect(handleHitRadius(false)).toBe(HANDLE_VISIBLE_RADIUS);
  });

  it('gives a finger a 44px target, which is a 22px radius', () => {
    expect(handleHitRadius(true)).toBe(22);
  });

  it('never makes the target smaller than the drawn handle', () => {
    expect(handleHitRadius(true)).toBeGreaterThanOrEqual(HANDLE_VISIBLE_RADIUS);
    expect(handleHitRadius(false)).toBeGreaterThanOrEqual(HANDLE_VISIBLE_RADIUS);
  });
});
