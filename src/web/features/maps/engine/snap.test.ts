import { describe, expect, it } from 'vitest';
import { alignDeltas, distributeDeltas } from './align';
import { ALL_SNAPS, gridStep, matchSize, snapBox, snapPoint, type SnapContext } from './snap';

const ctx = (extra: Partial<SnapContext> = {}): SnapContext => ({
  scale: 1,
  settings: ALL_SNAPS,
  gridStep: 20,
  points: [],
  segments: [],
  lines: [],
  ...extra,
});

describe('snapPoint', () => {
  it('snaps to a nearby end, and says which object it hit', () => {
    const r = snapPoint([103, 98], ctx({ points: [{ pt: [100, 100], id: 'a' }] }));
    expect(r).toMatchObject({ pt: [100, 100], kind: 'point', id: 'a' });
  });

  it('prefers a point over an edge over the grid', () => {
    const c = ctx({
      points: [{ pt: [100, 100], id: 'p' }],
      segments: [{ a: [0, 100], b: [200, 100], id: 's' }],
    });
    expect(snapPoint([101, 102], c).id).toBe('p');
    expect(snapPoint([50, 104], c)).toMatchObject({ kind: 'edge', id: 's', pt: [50, 100] });
  });

  it('lands on a line between two ends of another path (a T junction)', () => {
    const r = snapPoint([37, 8], ctx({ segments: [{ a: [0, 0], b: [100, 0], id: 'road' }] }));
    expect(r.pt).toEqual([37, 0]);
  });

  it('does not reach far: a point well away stays where it is', () => {
    const r = snapPoint(
      [55, 57],
      ctx({ points: [{ pt: [100, 100], id: 'a' }], settings: { ...ALL_SNAPS, grid: false } }),
    );
    expect(r.kind).toBe('none');
    expect(r.pt).toEqual([55, 57]);
  });

  it('reach follows zoom: the same pixels cover fewer world units when zoomed in', () => {
    const point = {
      points: [{ pt: [100, 100] as [number, number], id: 'a' }],
      settings: { ...ALL_SNAPS, grid: false },
    };
    expect(snapPoint([108, 100], ctx({ ...point, scale: 1 })).kind).toBe('point');
    expect(snapPoint([108, 100], ctx({ ...point, scale: 4 })).kind).toBe('none');
  });

  it('aligns to another object and reports a guide', () => {
    const r = snapPoint(
      [203, 77],
      ctx({ lines: [{ axis: 'x', pos: 200 }], settings: { ...ALL_SNAPS, grid: false } }),
    );
    expect(r.pt[0]).toBe(200);
    expect(r.kind).toBe('align');
    expect(r.guides[0]).toMatchObject({ axis: 'x', pos: 200 });
  });

  it('snaps to the grid only when close to a grid line', () => {
    expect(snapPoint([41, 79], ctx()).pt).toEqual([40, 80]);
    expect(snapPoint([50, 90], ctx()).pt).toEqual([50, 90]);
  });

  it('locks a drawn line to 15 degree steps, and to 45 with Shift', () => {
    const near = snapPoint([100, 3], ctx({ settings: { ...ALL_SNAPS, grid: false } }), {
      from: [0, 0],
    });
    expect(near.kind).toBe('angle');
    expect(near.pt[1]).toBeCloseTo(0, 5);
    const forced = snapPoint([100, 30], ctx({ settings: { ...ALL_SNAPS, grid: false } }), {
      from: [0, 0],
      constrain: true,
    });
    expect(Math.abs(forced.pt[1])).toBeLessThan(1e-6);
    const diag = snapPoint([100, 80], ctx({ settings: { ...ALL_SNAPS, grid: false } }), {
      from: [0, 0],
      constrain: true,
    });
    expect(diag.pt[1]).toBeCloseTo(diag.pt[0], 5);
  });

  it('does nothing when every kind is off', () => {
    const off = ctx({
      settings: { objects: false, align: false, grid: false, angle: false },
      points: [{ pt: [100, 100], id: 'a' }],
    });
    expect(snapPoint([101, 101], off).pt).toEqual([101, 101]);
  });
});

describe('snapBox', () => {
  it('lines a moving box up with another object edge', () => {
    const r = snapBox(
      { minX: 103, minY: 10, maxX: 153, maxY: 40 },
      ctx({ lines: [{ axis: 'x', pos: 100 }], settings: { ...ALL_SNAPS, grid: false } }),
    );
    expect(r.dx).toBe(-3);
    expect(r.guides[0]).toMatchObject({ axis: 'x', pos: 100 });
  });
  it('uses the nearest of its edges and middle', () => {
    const r = snapBox(
      { minX: 0, minY: 0, maxX: 100, maxY: 20 },
      ctx({ lines: [{ axis: 'x', pos: 52 }], settings: { ...ALL_SNAPS, grid: false } }),
    );
    expect(r.dx).toBe(2);
  });
  it('falls back to the grid for its corner', () => {
    const r = snapBox({ minX: 42, minY: 59, maxX: 90, maxY: 90 }, ctx());
    expect([r.dx, r.dy]).toEqual([-2, 1]);
  });
});

describe('helpers', () => {
  it('gridStep keeps cells readable', () => {
    expect(gridStep(1)).toBe(20);
    expect(gridStep(0.1)).toBe(200);
    expect(gridStep(8)).toBe(5);
  });
  it('matchSize picks up a similar size already on the map', () => {
    expect(matchSize(98, 41, [{ w: 100, h: 40 }])).toEqual({ w: 100, h: 40 });
    expect(matchSize(150, 41, [{ w: 100, h: 40 }])).toEqual({ w: 150, h: 40 });
  });
});

describe('alignDeltas and distributeDeltas', () => {
  const unit = (id: string, minX: number, minY: number, w: number, h: number) => ({
    ids: [id],
    box: { minX, minY, maxX: minX + w, maxY: minY + h },
  });
  const units = [unit('a', 0, 0, 10, 10), unit('b', 30, 20, 20, 10), unit('c', 100, 50, 10, 30)];
  it('aligns left, right and centres', () => {
    expect(alignDeltas(units, 'left').get('c')).toEqual([-100, 0]);
    expect(alignDeltas(units, 'right').get('a')).toEqual([100, 0]);
    expect(alignDeltas(units, 'hcenter').get('b')).toEqual([15, 0]);
    expect(alignDeltas(units, 'top').get('c')).toEqual([0, -50]);
    expect(alignDeltas(units, 'bottom').get('a')).toEqual([0, 70]);
    expect(alignDeltas(units, 'vcenter').get('a')?.[1]).toBe(40 - 5);
  });
  it('does nothing for one object', () => {
    expect(alignDeltas([unit('a', 0, 0, 5, 5)], 'left').size).toBe(0);
  });
  it('distributes equal gaps and keeps the outer two in place', () => {
    const d = distributeDeltas(units, 'h');
    expect(d.get('a')).toBeUndefined();
    expect(d.get('c')).toBeUndefined();
    // Total span 110, sizes 40, so each gap is 35: b moves to start at 45.
    expect(d.get('b')).toEqual([15, 0]);
  });
  it('needs three objects to distribute', () => {
    expect(distributeDeltas(units.slice(0, 2), 'h').size).toBe(0);
  });
});
