import { describe, expect, it } from 'vitest';
import { dragBox, fromRecognized, makeConnector, makeText } from './make';

const style = { stroke: 'ink', fill: null, width: 3, dash: 'solid' } as const;

describe('dragBox', () => {
  it('makes a box from two corners in any direction', () => {
    expect(dragBox([10, 20], [50, 5], false)).toEqual({ x: 10, y: 5, w: 40, h: 15 });
  });
  it('Shift makes it square, growing the way it was dragged', () => {
    expect(dragBox([10, 10], [50, 25], true)).toEqual({ x: 10, y: 10, w: 40, h: 40 });
    expect(dragBox([10, 10], [-30, -25], true)).toEqual({ x: -30, y: -30, w: 40, h: 40 });
  });
});

describe('fromRecognized', () => {
  it('builds objects with the current style and layer', () => {
    const circle = fromRecognized(
      { kind: 'ellipse', cx: 50, cy: 50, rx: 20, ry: 20, rot: 0, circle: true },
      style,
      'L',
    );
    expect(circle.label).toBe('Circle');
    expect(circle.shape).toMatchObject({ t: 'ellipse', cx: 50, rx: 20, layer: 'L' });
    const rect = fromRecognized(
      { kind: 'rect', cx: 50, cy: 30, w: 100, h: 40, rot: 0, square: false },
      style,
      'L',
    );
    expect(rect.shape).toMatchObject({ t: 'rect', x: 0, y: 10, w: 100, h: 40 });
    expect(fromRecognized({ kind: 'line', a: [0, 0], b: [5, 5] }, style, 'L').shape).toMatchObject({
      t: 'connector',
      head: 'none',
    });
    expect(fromRecognized({ kind: 'arrow', a: [0, 0], b: [5, 5] }, style, 'L').shape).toMatchObject(
      { head: 'end' },
    );
    expect(
      fromRecognized(
        {
          kind: 'polygon',
          pts: [
            [0, 0],
            [5, 0],
            [0, 5],
          ],
        },
        style,
        'L',
      ).label,
    ).toBe('Triangle');
  });
  it('a closed path keeps the fill, an open one drops it', () => {
    const filled = { ...style, fill: 'sky' };
    const closed = fromRecognized(
      {
        kind: 'path',
        pts: [
          [0, 0],
          [5, 5],
          [0, 9],
        ],
        closed: true,
      },
      filled,
      'L',
    ).shape;
    const open = fromRecognized(
      {
        kind: 'path',
        pts: [
          [0, 0],
          [5, 5],
        ],
        closed: false,
      },
      filled,
      'L',
    ).shape;
    expect(closed.style.fill).toBe('sky');
    expect(open.style.fill).toBeNull();
  });
});

describe('other makers', () => {
  it('connectors keep only the ends they have', () => {
    const c = makeConnector({ pt: [0, 0], ref: 'a' }, { pt: [9, 9] }, style, 'L');
    expect(c.from).toEqual({ pt: [0, 0], ref: 'a' });
    expect('ref' in c.to).toBe(false);
  });
  it('sticky notes get a fill and a width, plain text none', () => {
    expect(makeText([0, 0], 'hi', 'sticky', style, 'L')).toMatchObject({
      w: 180,
      style: { fill: 'amber' },
    });
    expect('w' in makeText([0, 0], 'hi', 'plain', style, 'L')).toBe(false);
  });
});
