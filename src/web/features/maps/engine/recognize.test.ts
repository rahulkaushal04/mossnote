import { describe, expect, it } from 'vitest';
import { recognize, resample, simplify, smoothPoints } from './recognize';
import type { MPt } from './vec';

/** A tiny deterministic generator, so "hand wobble" is the same on every run. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296 - 0.5;
};
const jitter = (pts: MPt[], amount: number, seed = 7): MPt[] => {
  const r = rng(seed);
  return pts.map(([x, y]) => [x + r() * amount, y + r() * amount]);
};
const along = (a: MPt, b: MPt, n: number): MPt[] =>
  Array.from({ length: n }, (_, i) => [
    a[0] + ((b[0] - a[0]) * i) / n,
    a[1] + ((b[1] - a[1]) * i) / n,
  ]);
const circle = (cx: number, cy: number, rx: number, ry: number, n = 80, start = 0.6): MPt[] =>
  Array.from({ length: n + 4 }, (_, i) => {
    const t = start + (i / n) * Math.PI * 2;
    return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry];
  });
const poly = (corners: MPt[], per = 20): MPt[] =>
  corners
    .flatMap((c, i) => along(c, corners[(i + 1) % corners.length]!, per))
    .concat([corners[0]!]);

const opts = { scale: 1 };

describe('recognize', () => {
  it('a tiny stroke is a dot', () => {
    expect(
      recognize(
        [
          [5, 5],
          [6, 6],
        ],
        opts,
      ).kind,
    ).toBe('dot');
  });

  it('a wobbly straight stroke becomes a line between its ends', () => {
    const r = recognize(jitter(along([0, 0], [200, 30], 40), 5), opts);
    expect(r.kind).toBe('line');
    if (r.kind === 'line') {
      expect(Math.abs(r.a[0])).toBeLessThan(6);
      expect(Math.abs(r.b[0] - 200)).toBeLessThan(6);
    }
  });

  it('a line with a short turn back at the end becomes an arrow to the tip', () => {
    const shaft = along([0, 0], [200, 0], 40);
    const wing = along([200, 0], [185, 14], 6);
    const r = recognize(jitter([...shaft, ...wing], 2), opts);
    expect(r.kind).toBe('arrow');
    if (r.kind === 'arrow') expect(Math.abs(r.b[0] - 200)).toBeLessThan(8);
  });

  it('a wavy path stays a path, smoothed and with far fewer points', () => {
    const wave: MPt[] = Array.from({ length: 120 }, (_, i) => [i * 3, Math.sin(i / 10) * 30]);
    const r = recognize(jitter(wave, 3), opts);
    expect(r.kind).toBe('path');
    if (r.kind === 'path') {
      expect(r.closed).toBe(false);
      expect(r.pts.length).toBeLessThan(60);
      expect(r.pts.length).toBeGreaterThan(5);
    }
  });

  it('a rough circle becomes a circle at the right place and size', () => {
    const r = recognize(jitter(circle(100, 80, 50, 50), 7), opts);
    expect(r.kind).toBe('ellipse');
    if (r.kind === 'ellipse') {
      expect(r.circle).toBe(true);
      expect(Math.abs(r.cx - 100)).toBeLessThan(5);
      expect(Math.abs(r.cy - 80)).toBeLessThan(5);
      expect(Math.abs(r.rx - 50)).toBeLessThan(6);
      expect(r.rx).toBe(r.ry);
    }
  });

  it('a rough oval becomes an ellipse, not a circle', () => {
    const r = recognize(jitter(circle(0, 0, 90, 40), 6), opts);
    expect(r.kind).toBe('ellipse');
    if (r.kind === 'ellipse') {
      expect(r.circle).toBe(false);
      expect(r.rx).toBeGreaterThan(r.ry * 1.6);
    }
  });

  it('a rough rectangle is straightened into an upright rectangle', () => {
    const r = recognize(
      jitter(
        poly([
          [0, 0],
          [160, 4],
          [158, 90],
          [-3, 86],
        ]),
        5,
      ),
      opts,
    );
    expect(r.kind).toBe('rect');
    if (r.kind === 'rect') {
      expect(r.rot).toBe(0);
      expect(r.square).toBe(false);
      expect(Math.abs(r.w - 160)).toBeLessThan(10);
      expect(Math.abs(r.h - 88)).toBeLessThan(10);
    }
  });

  it('a nearly square rectangle becomes a perfect square', () => {
    const r = recognize(
      jitter(
        poly([
          [0, 0],
          [100, 0],
          [102, 96],
          [2, 98],
        ]),
        4,
      ),
      opts,
    );
    expect(r.kind).toBe('rect');
    if (r.kind === 'rect') {
      expect(r.square).toBe(true);
      expect(r.w).toBe(r.h);
    }
  });

  it('a clearly tilted rectangle keeps its tilt', () => {
    const t = (30 * Math.PI) / 180;
    const rot = (p: MPt): MPt => [
      p[0] * Math.cos(t) - p[1] * Math.sin(t),
      p[0] * Math.sin(t) + p[1] * Math.cos(t),
    ];
    const r = recognize(
      jitter(
        poly(
          [
            [0, 0],
            [180, 0],
            [180, 70],
            [0, 70],
          ].map((p) => rot(p as MPt)),
        ),
        3,
      ),
      opts,
    );
    expect(r.kind).toBe('rect');
    if (r.kind === 'rect') expect(Math.abs(Math.abs(r.rot) - 30)).toBeLessThan(8);
  });

  it('a rough triangle becomes a three-cornered polygon', () => {
    const r = recognize(
      jitter(
        poly([
          [0, 0],
          [150, 10],
          [70, 120],
        ]),
        4,
      ),
      opts,
    );
    expect(r.kind).toBe('polygon');
    if (r.kind === 'polygon') expect(r.pts).toHaveLength(3);
  });

  it('a lumpy closed blob becomes a smooth closed path', () => {
    const blob: MPt[] = circle(0, 0, 60, 60, 90).map(([x, y], i) => [
      x * (1 + 0.35 * Math.sin(i / 6)),
      y * (1 + 0.3 * Math.cos(i / 4)),
    ]);
    const r = recognize(blob, opts);
    expect(['path', 'polygon']).toContain(r.kind);
  });

  it('thresholds follow the zoom: the same pixel wobble still reads as a line when zoomed out', () => {
    // 0.1 pixels per world unit: a long stroke in world units that is short on screen.
    const r = recognize(jitter(along([0, 0], [2000, 100], 40), 40), { scale: 0.1 });
    expect(r.kind).toBe('line');
  });
});

describe('helpers', () => {
  it('simplify keeps corners and drops points on a straight run', () => {
    expect(
      simplify(
        [
          [0, 0],
          [5, 0.1],
          [10, 0],
          [10, 10],
        ],
        1,
      ),
    ).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });
  it('resample returns evenly spaced points', () => {
    const out = resample(
      [
        [0, 0],
        [100, 0],
      ],
      10,
    );
    expect(out.length).toBeGreaterThanOrEqual(10);
    expect(out[1]?.[0]).toBeCloseTo(10, 0);
  });
  it('smoothPoints keeps the ends fixed', () => {
    const out = smoothPoints(
      [
        [0, 0],
        [5, 10],
        [10, 0],
      ],
      2,
    );
    expect(out[0]).toEqual([0, 0]);
    expect(out[2]).toEqual([10, 0]);
    expect(out[1]?.[1]).toBeLessThan(10);
  });
});
