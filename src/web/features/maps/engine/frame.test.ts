import { describe, expect, it } from 'vitest';
import type { MapShape } from '@shared/schemas/map';
import { objectsOf, scaleObjects, transformObjects, type Doc } from './doc';
import { frameFor, handlePoint, resizeXform, rotateHandlePoint } from './frame';

const STYLE = { stroke: 'ink', fill: null, width: 3, dash: 'solid' } as const;
const rect = (extra: Partial<MapShape> = {}): MapShape =>
  ({
    id: 'r',
    layer: 'l',
    t: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    style: STYLE,
    ...extra,
  }) as MapShape;
const doc = (shape: MapShape): Doc => ({
  scene: { v: 2, layers: [{ id: 'l', name: 'L' }], shapes: [shape] },
  pins: [],
});

describe('frame and resize', () => {
  it('uses the selection box for plain objects and the object axes for a turned one', () => {
    const o = objectsOf(doc(rect()));
    const f = frameFor([o.get('r') as never], (o.get('r') as never as { box: never }).box);
    expect(f).toMatchObject({ w: 100, h: 50, rot: 0, local: false });
    const t = objectsOf(doc(rect({ rot: 30 })));
    const ft = frameFor([t.get('r') as never], (t.get('r') as never as { box: never }).box);
    expect(ft).toMatchObject({ w: 100, h: 50, rot: 30, local: true });
  });

  it('dragging the east handle keeps the west edge fixed', () => {
    const d = doc(rect());
    const o = objectsOf(d);
    const f = frameFor([o.get('r') as never], (o.get('r') as never as { box: never }).box);
    const x = resizeXform(f, 'e', [200, 25]);
    const out = transformObjects(d, new Set(['r']), x).scene.shapes[0] as Extract<
      MapShape,
      { t: 'rect' }
    >;
    expect(out).toMatchObject({ x: 0, w: 200, h: 50 });
  });

  it('a corner drag with Shift keeps the proportions', () => {
    const d = doc(rect());
    const o = objectsOf(d);
    const f = frameFor([o.get('r') as never], (o.get('r') as never as { box: never }).box);
    const out = transformObjects(
      d,
      new Set(['r']),
      resizeXform(f, 'se', [300, 80], { uniform: true }),
    ).scene.shapes[0] as Extract<MapShape, { t: 'rect' }>;
    expect(out.w / out.h).toBeCloseTo(2, 1);
  });

  it('resizing a turned rectangle works along its own axes', () => {
    const d = doc(rect({ rot: 90 }));
    const o = objectsOf(d);
    const f = frameFor([o.get('r') as never], (o.get('r') as never as { box: never }).box);
    // Dragging its east handle (which now points down) outwards lengthens its width.
    const east = handlePoint(f, 'e');
    const x = resizeXform(f, 'e', [east[0], east[1] + 100]);
    const out = transformObjects(d, new Set(['r']), x).scene.shapes[0] as Extract<
      MapShape,
      { t: 'rect' }
    >;
    expect(out.w).toBeCloseTo(200, 0);
    expect(out.h).toBeCloseTo(50, 0);
  });

  it('does not collapse below a small size', () => {
    const d = doc(rect());
    const o = objectsOf(d);
    const f = frameFor([o.get('r') as never], (o.get('r') as never as { box: never }).box);
    const out = transformObjects(d, new Set(['r']), resizeXform(f, 'e', [-50, 25])).scene
      .shapes[0] as Extract<MapShape, { t: 'rect' }>;
    expect(out.w).toBeGreaterThanOrEqual(4);
  });

  it('puts the rotate handle above the frame', () => {
    const f = { center: [50, 25] as [number, number], w: 100, h: 50, rot: 0, local: false };
    expect(rotateHandlePoint(f, 20)).toEqual([50, -20]);
  });

  it('scaleObjects scales a whole selection about a corner', () => {
    const out = scaleObjects(doc(rect()), new Set(['r']), [0, 0], 0.5, 0.5).scene.shapes[0];
    expect(out).toMatchObject({ w: 50, h: 25 });
  });
});
