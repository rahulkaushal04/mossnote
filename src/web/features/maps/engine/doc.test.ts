import { describe, expect, it } from 'vitest';
import type { MapShape } from '@shared/schemas/map';
import type { MapPin } from '@shared/types';
import {
  addLayer,
  addShapes,
  alignObjects,
  copyObjects,
  distributeObjects,
  expandGroups,
  group,
  makePin,
  moveLayer,
  moveObjects,
  moveToLayer,
  objectsOf,
  pasteClip,
  removeLayer,
  removeObjects,
  reorder,
  rotateObjects,
  scaleObjects,
  setFlag,
  ungroup,
  unitsOf,
  type Doc,
} from './doc';
import { boundaryPoint, connectorGeometry, smoothPathD, textLayout } from './shapes';

const STYLE = { stroke: 'ink', fill: null, width: 3, dash: 'solid' } as const;
const rect = (
  id: string,
  x: number,
  y: number,
  w = 40,
  h = 20,
  extra: Partial<MapShape> = {},
): MapShape =>
  ({ id, layer: 'layer-1', t: 'rect', x, y, w, h, style: STYLE, ...extra }) as MapShape;
const conn = (
  id: string,
  from: object,
  to: object,
  route: 'straight' | 'curve' | 'elbow' = 'straight',
): MapShape => ({
  id,
  layer: 'layer-1',
  t: 'connector',
  from: from as never,
  to: to as never,
  route,
  head: 'end',
  style: STYLE,
});
const doc = (shapes: MapShape[] = [], pins: MapPin[] = []): Doc => ({
  scene: { v: 2, layers: [{ id: 'layer-1', name: 'Layer 1' }], shapes },
  pins,
});
const ids = (...v: string[]) => new Set(v);

describe('resolving objects', () => {
  it('finds bounds and centres, including for a rotated rectangle', () => {
    const o = objectsOf(doc([rect('a', 0, 0, 100, 20, { rot: 90 })]));
    const a = o.get('a');
    expect(a?.center).toEqual([50, 10]);
    expect((a?.box.maxX ?? 0) - (a?.box.minX ?? 0)).toBeCloseTo(20, 5);
    expect((a?.box.maxY ?? 0) - (a?.box.minY ?? 0)).toBeCloseTo(100, 5);
  });

  it('a connector attached to two rectangles meets their edges and follows when one moves', () => {
    const d = doc([
      rect('a', 0, 0),
      rect('b', 200, 0),
      conn('c', { pt: [0, 0], ref: 'a' }, { pt: [0, 0], ref: 'b' }),
    ]);
    const geom = (dd: Doc) =>
      connectorGeometry(objectsOf(dd).get('c')?.shape as never, objectsOf(dd));
    expect(geom(d).start.pt[0]).toBeCloseTo(40, 5);
    expect(geom(d).end.pt[0]).toBeCloseTo(200, 5);
    const moved = moveObjects(d, ids('b'), 100, 0);
    expect(geom(moved).end.pt[0]).toBeCloseTo(300, 5);
  });

  it('a connector to a pin stops at the pin edge', () => {
    const pin = makePin('m', 'p1', 100, 0, 'layer-1');
    const d = doc([conn('c', { pt: [0, 0] }, { pt: [100, 0], ref: 'p1' })], [pin]);
    const g = connectorGeometry(objectsOf(d).get('c')?.shape as never, objectsOf(d));
    expect(g.end.pt[0]).toBeLessThan(100);
    expect(g.end.pt[0]).toBeGreaterThan(80);
  });

  it('elbow and curve routes produce a bend', () => {
    const o = objectsOf(doc());
    const elbow = connectorGeometry(
      conn('e', { pt: [0, 0] }, { pt: [100, 60] }, 'elbow') as never,
      o,
    );
    expect(elbow.pts).toHaveLength(4);
    const curve = connectorGeometry(
      conn('k', { pt: [0, 0] }, { pt: [100, 0] }, 'curve') as never,
      o,
    );
    expect(curve.pts.some((p) => Math.abs(p[1]) > 5)).toBe(true);
  });

  it('boundaryPoint of an ellipse lies on the ellipse', () => {
    const d = doc([
      { id: 'e', layer: 'layer-1', t: 'ellipse', cx: 0, cy: 0, rx: 50, ry: 20, style: STYLE },
    ]);
    const p = boundaryPoint(objectsOf(d).get('e') as never, [200, 0]);
    expect(p[0]).toBeCloseTo(50, 3);
  });

  it('an anchored note follows its object', () => {
    const note: MapShape = {
      id: 'n',
      layer: 'layer-1',
      t: 'text',
      x: 0,
      y: 0,
      text: 'hi',
      size: 14,
      kind: 'card',
      anchor: { ref: 'a', dx: 0, dy: -60 },
      style: STYLE,
    };
    const d = doc([rect('a', 100, 100), note]);
    const before = objectsOf(d).get('n')?.center as [number, number];
    const after = objectsOf(moveObjects(d, ids('a'), 50, 10)).get('n')?.center as [number, number];
    expect(after[0] - before[0]).toBeCloseTo(50, 5);
    expect(after[1] - before[1]).toBeCloseTo(10, 5);
  });

  it('wraps card text to its width', () => {
    const l = textLayout({
      id: 't',
      layer: 'l',
      t: 'text',
      x: 0,
      y: 0,
      text: 'one two three four five six seven',
      size: 14,
      kind: 'card',
      w: 100,
      style: STYLE,
    });
    expect(l.lines.length).toBeGreaterThan(2);
    expect(l.boxW).toBe(100);
  });

  it('smooth path data passes through every point', () => {
    const d = smoothPathD(
      [
        [0, 0],
        [10, 10],
        [20, 0],
      ],
      false,
    );
    expect(d.startsWith('M0 0')).toBe(true);
    expect(d).toContain('10 10');
    expect(d.endsWith('20 0')).toBe(true);
  });
});

describe('moving, scaling, rotating', () => {
  it('moves shapes and pins together', () => {
    const d = doc([rect('a', 0, 0)], [makePin('m', 'p', 5, 5, 'layer-1')]);
    const m = moveObjects(d, ids('a', 'p'), 10, 20);
    expect(m.scene.shapes[0]).toMatchObject({ x: 10, y: 20 });
    expect(m.pins[0]).toMatchObject({ x: 15, y: 25 });
  });

  it('scales a rectangle about a corner', () => {
    const m = scaleObjects(doc([rect('a', 0, 0, 40, 20)]), ids('a'), [0, 0], 2, 3);
    expect(m.scene.shapes[0]).toMatchObject({ x: 0, y: 0, w: 80, h: 60 });
  });

  it('rotating a rectangle about its centre keeps the centre and adds rotation', () => {
    const m = rotateObjects(doc([rect('a', 0, 0, 40, 20)]), ids('a'), [20, 10], 30);
    const s = m.scene.shapes[0] as Extract<MapShape, { t: 'rect' }>;
    expect(s.rot).toBe(30);
    expect(s.x + s.w / 2).toBeCloseTo(20, 1);
  });

  it('rotating a point about an outside centre moves it round', () => {
    const m = rotateObjects(doc([], [makePin('m', 'p', 10, 0, 'layer-1')]), ids('p'), [0, 0], 90);
    expect(m.pins[0]?.x).toBeCloseTo(0, 1);
    expect(m.pins[0]?.y).toBeCloseTo(10, 1);
  });
});

describe('deleting', () => {
  it('detaches connectors and notes instead of leaving dead references', () => {
    const note: MapShape = {
      id: 'n',
      layer: 'layer-1',
      t: 'text',
      x: 0,
      y: 0,
      text: 'x',
      size: 14,
      kind: 'card',
      anchor: { ref: 'a', dx: 0, dy: -50 },
      style: STYLE,
    };
    const d = doc([
      rect('a', 0, 0),
      rect('b', 200, 0),
      conn('c', { pt: [0, 0], ref: 'a' }, { pt: [0, 0], ref: 'b' }),
      note,
    ]);
    const out = removeObjects(d, ids('a'));
    const c = out.scene.shapes.find((s) => s.id === 'c');
    expect(c?.t === 'connector' && c.from.ref).toBeUndefined();
    expect(c?.t === 'connector' && c.to.ref).toBe('b');
    const n = out.scene.shapes.find((s) => s.id === 'n');
    expect(n?.t === 'text' && n.anchor).toBeUndefined();
  });
});

describe('groups, order, locks', () => {
  const base = doc([rect('a', 0, 0), rect('b', 50, 0), rect('c', 100, 0)]);
  it('groups and ungroups, and selecting one member selects the group', () => {
    const g = group(base, ids('a', 'b'));
    const o = objectsOf(g);
    expect([...expandGroups(o, ['a'])].sort()).toEqual(['a', 'b']);
    expect(unitsOf(o, ['a', 'b', 'c'])).toHaveLength(2);
    const u = ungroup(g, ids('a'));
    expect(objectsOf(u).get('a')?.group).toBeUndefined();
    expect(objectsOf(u).get('b')?.group).toBeUndefined();
  });
  it('does not group a single object', () => {
    expect(group(base, ids('a'))).toBe(base);
  });
  it('reorders', () => {
    const order = (d: Doc) => d.scene.shapes.map((s) => s.id).join('');
    expect(order(reorder(base, ids('a'), 'front'))).toBe('bca');
    expect(order(reorder(base, ids('c'), 'back'))).toBe('cab');
    expect(order(reorder(base, ids('a'), 'forward'))).toBe('bac');
    expect(order(reorder(base, ids('c'), 'backward'))).toBe('acb');
  });
  it('locks and hides, and clears the flag again', () => {
    const l = setFlag(base, ids('a'), 'locked', true);
    expect(l.scene.shapes[0]?.locked).toBe(true);
    expect('locked' in (setFlag(l, ids('a'), 'locked', false).scene.shapes[0] as object)).toBe(
      false,
    );
  });
});

describe('align and distribute through the document', () => {
  it('aligns by group as one unit', () => {
    const d = group(
      doc([rect('a', 0, 0, 10, 10), rect('b', 20, 0, 10, 10), rect('c', 100, 30, 10, 10)]),
      ids('a', 'b'),
    );
    const out = alignObjects(d, ['a', 'b', 'c'], 'right');
    expect(out.scene.shapes.map((s) => (s as { x: number }).x)).toEqual([80, 100, 100]);
  });
  it('distributes evenly', () => {
    const d = doc([rect('a', 0, 0, 10, 10), rect('b', 15, 0, 10, 10), rect('c', 100, 0, 10, 10)]);
    const out = distributeObjects(d, ['a', 'b', 'c'], 'h');
    expect((out.scene.shapes[1] as { x: number }).x).toBe(50);
  });
});

describe('copy and paste', () => {
  it('pastes new ids, keeps links among the copies, and offsets position', () => {
    const d = doc([
      rect('a', 0, 0),
      rect('b', 100, 0),
      conn('c', { pt: [0, 0], ref: 'a' }, { pt: [0, 0], ref: 'b' }),
    ]);
    const clip = copyObjects(d, ids('a', 'b', 'c'));
    let n = 0;
    const out = pasteClip(d, clip, [20, 20], { newPinId: () => `P${n++}`, mapId: 'm', now: 'now' });
    expect(out.doc.scene.shapes).toHaveLength(6);
    const copy = out.doc.scene.shapes.slice(3);
    expect(new Set(copy.map((s) => s.id)).size).toBe(3);
    const c = copy.find((s) => s.t === 'connector');
    const newA = copy.find((s) => s.t === 'rect');
    expect(c?.t === 'connector' && c.from.ref).toBe(newA?.id);
    expect(newA).toMatchObject({ x: 20, y: 20 });
  });
  it('copies pins with new ids and keeps their properties', () => {
    const pin = {
      ...makePin('m', 'p', 1, 1, 'layer-1', {
        label: 'Gate',
        props: { icon: 'door', tags: ['x'] },
      }),
    };
    const d = doc([], [pin]);
    const out = pasteClip(d, copyObjects(d, ids('p')), [10, 0], {
      newPinId: () => 'NEW',
      mapId: 'm2',
      now: 'now',
    });
    expect(out.doc.pins[1]).toMatchObject({ id: 'NEW', mapId: 'm2', x: 11, label: 'Gate' });
    expect(out.doc.pins[1]?.props).toMatchObject({ icon: 'door', tags: ['x'] });
  });
  it('a pasted group stays a group, separate from the original', () => {
    const d = group(doc([rect('a', 0, 0), rect('b', 50, 0)]), ids('a', 'b'));
    const out = pasteClip(d, copyObjects(d, ids('a', 'b')), [0, 10], {
      newPinId: () => 'x',
      mapId: 'm',
      now: 'n',
    });
    const groups = new Set(out.doc.scene.shapes.map((s) => s.group));
    expect(groups.size).toBe(2);
  });
});

describe('layers', () => {
  it('adds, reorders and removes a layer, moving its objects down', () => {
    let d = doc([rect('a', 0, 0)]);
    d = addLayer(d, 'Paths', 'layer-2');
    d = moveToLayer(d, ids('a'), 'layer-2');
    expect(d.scene.shapes[0]?.layer).toBe('layer-2');
    d = moveLayer(d, 'layer-2', -1);
    expect(d.scene.layers.map((l) => l.id)).toEqual(['layer-2', 'layer-1']);
    d = removeLayer(d, 'layer-2');
    expect(d.scene.layers.map((l) => l.id)).toEqual(['layer-1']);
    expect(d.scene.shapes[0]?.layer).toBe('layer-1');
  });
  it('never removes the last layer', () => {
    const d = doc();
    expect(removeLayer(d, 'layer-1')).toBe(d);
  });
  it('addShapes appends', () => {
    expect(addShapes(doc(), [rect('z', 0, 0)]).scene.shapes).toHaveLength(1);
  });
});
