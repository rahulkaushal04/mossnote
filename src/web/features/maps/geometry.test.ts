import { describe, expect, it } from 'vitest';
import { clampCoord, fitView, panBy, toScreen, toWorld, visibleBox, zoomAt } from './geometry';

const size = { w: 800, h: 600 };

describe('view maths', () => {
  it('converts between screen and world and back', () => {
    const view = { cx: 120, cy: -40, scale: 2.5 };
    const [sx, sy] = toScreen(view, size, 33, 77);
    const [x, y] = toWorld(view, size, sx, sy);
    expect(x).toBeCloseTo(33);
    expect(y).toBeCloseTo(77);
  });

  it('zooms about the pointer, which stays over the same world point', () => {
    const view = { cx: 0, cy: 0, scale: 1 };
    const before = toWorld(view, size, 600, 100);
    const zoomed = zoomAt(view, size, 600, 100, 2);
    const after = toWorld(zoomed, size, 600, 100);
    expect(zoomed.scale).toBe(2);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('clamps the zoom, with room to zoom a long way out', () => {
    expect(zoomAt({ cx: 0, cy: 0, scale: 1 }, size, 0, 0, 1000).scale).toBe(24);
    expect(zoomAt({ cx: 0, cy: 0, scale: 1 }, size, 0, 0, 0.0001).scale).toBe(0.02);
  });

  it('pans by screen pixels', () => {
    expect(panBy({ cx: 0, cy: 0, scale: 2 }, 100, -40)).toEqual({ cx: -50, cy: 20, scale: 2 });
  });

  it('shows the visible part of the world', () => {
    expect(visibleBox({ cx: 0, cy: 0, scale: 1 }, size)).toEqual({
      minX: -400,
      minY: -300,
      maxX: 400,
      maxY: 300,
    });
  });
});

describe('fit', () => {
  it('falls back to the default view for an empty map', () => {
    expect(fitView(null, size)).toEqual({ cx: 0, cy: 0, scale: 1 });
  });
  it('centres on a box and zooms to fit it', () => {
    const view = fitView({ minX: 0, minY: 0, maxX: 2000, maxY: 500 }, size);
    expect(view.cx).toBe(1000);
    expect(view.cy).toBe(250);
    expect(view.scale).toBeLessThan(0.5);
  });
  it('does not blow a tiny drawing up past the limit', () => {
    expect(fitView({ minX: 0, minY: 0, maxX: 5, maxY: 5 }, size).scale).toBeLessThanOrEqual(2);
  });
});

describe('clampCoord', () => {
  it('keeps points inside the area the server accepts', () => {
    expect(clampCoord(500000)).toBe(99000);
    expect(clampCoord(-500000)).toBe(-99000);
    expect(clampCoord(12)).toBe(12);
  });
});
