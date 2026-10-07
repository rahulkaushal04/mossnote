import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MapDetail, MapPin, MapVersionInfo } from '@shared/types';
import { Api, newId } from '../testing/api';
import { makeTestApp, type TestApp } from '../testing/app';

let t: TestApp;
let api: Api;
beforeEach(async () => {
  t = await makeTestApp();
  api = new Api(t);
});
afterEach(() => {
  api.expectIndexConsistent();
  api.expectNoOrphans();
  t.close();
});

const STYLE = { stroke: 'ink', fill: null, width: 3, dash: 'solid' };
const rect = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  layer: 'layer-1',
  t: 'rect',
  x: 0,
  y: 0,
  w: 40,
  h: 20,
  style: STYLE,
  ...extra,
});
const scene = (shapes: unknown[], layers: unknown[] = [{ id: 'layer-1', name: 'Layer 1' }]) => ({
  v: 2,
  layers,
  shapes,
});
const makeMap = async (body: Record<string, unknown> = {}) => {
  api.tick();
  return api.json<MapDetail>(await t.call('POST', '/api/maps', body), 201);
};
const get = async (id: string) => api.json<MapDetail>(await t.call('GET', `/api/maps/${id}`));
const changes = async (id: string, body: Record<string, unknown>) => {
  api.tick();
  return api.json<{ updatedAt: string }>(await t.call('POST', `/api/maps/${id}/changes`, body));
};

describe('objects and layers (AC-MAP-9, AC-MAP-10)', () => {
  it('stores every object kind with names, locks, groups, notes and styles', async () => {
    const map = await makeMap();
    const shapes = [
      rect('r', { name: 'Hall', locked: true, hidden: false, group: 'g1', note: 'Wide door' }),
      {
        id: 'e',
        layer: 'layer-1',
        t: 'ellipse',
        cx: 5,
        cy: 5,
        rx: 10,
        ry: 6,
        rot: 30,
        style: { ...STYLE, fill: '#aabbcc', dash: 'dashed' },
      },
      {
        id: 'p',
        layer: 'layer-1',
        t: 'polygon',
        pts: [
          [0, 0],
          [9, 0],
          [9, 9],
        ],
        style: STYLE,
      },
      {
        id: 'w',
        layer: 'layer-1',
        t: 'path',
        pts: [
          [0, 0],
          [3, 4],
          [8, 1],
        ],
        smooth: true,
        closed: false,
        style: STYLE,
      },
      {
        id: 'c',
        layer: 'layer-1',
        t: 'connector',
        from: { pt: [0, 0], ref: 'r' },
        to: { pt: [9, 9] },
        route: 'elbow',
        head: 'both',
        style: STYLE,
      },
      {
        id: 'n',
        layer: 'layer-1',
        t: 'text',
        x: 1,
        y: 2,
        text: 'Look here',
        size: 14,
        kind: 'sticky',
        w: 120,
        anchor: { ref: 'r', dx: 10, dy: -20 },
        style: STYLE,
      },
    ];
    await changes(map.id, { scene: scene(shapes) });
    expect((await get(map.id)).scene.shapes).toEqual(shapes);
  });

  it('a layered template starts with plain named layers and nothing drawn', async () => {
    const map = await makeMap({ template: 'layers' });
    expect(map.scene.layers.map((l) => l.name)).toEqual([
      'Background',
      'Terrain',
      'Paths',
      'Locations',
      'Notes',
    ]);
    expect(map.scene.shapes).toEqual([]);
  });

  it('keeps layer visibility, locks, guides and the measure scale', async () => {
    const map = await makeMap();
    const s = {
      ...scene(
        [],
        [
          { id: 'a', name: 'Terrain', hidden: true },
          { id: 'b', name: 'Paths', locked: true },
        ],
      ),
      guides: [{ axis: 'x', pos: 10 }],
      scale: { unit: 'tiles', size: 16 },
    };
    await changes(map.id, { scene: s });
    expect((await get(map.id)).scene).toEqual(s);
  });

  it('converts the first, flat scene format when it is read from the database', async () => {
    const map = await makeMap();
    t.database.sqlite.prepare('UPDATE maps SET scene = ? WHERE id = ?').run(
      JSON.stringify([
        {
          id: 'a',
          t: 'stroke',
          color: 'moss',
          w: 4,
          pts: [
            [0, 0],
            [5, 5],
          ],
        },
        {
          id: 'b',
          t: 'area',
          color: 'sky',
          pts: [
            [0, 0],
            [5, 0],
            [5, 5],
          ],
        },
        { id: 'c', t: 'arrow', color: 'rose', a: [0, 0], b: [4, 4] },
        { id: 'd', t: 'label', color: 'ink', x: 1, y: 1, text: 'shore' },
      ]),
      map.id,
    );
    const read = await get(map.id);
    expect(read.scene.v).toBe(2);
    expect(read.scene.shapes.map((x) => x.t)).toEqual(['path', 'polygon', 'connector', 'text']);
  });
});

describe('pins as markers (AC-MAP-11)', () => {
  it('stores type, icon, status, tags, fields, layer and a hex colour', async () => {
    const map = await makeMap();
    const props = {
      type: 'type-1',
      icon: 'door',
      status: 'checked',
      tags: ['north', 'revisit'],
      fields: [{ label: 'Depth', value: '3' }],
      layer: 'layer-1',
      locked: true,
      group: 'g',
    };
    api.tick();
    const pin = await api.json<MapPin>(
      await t.call('POST', `/api/maps/${map.id}/pins`, { x: 1, y: 2, color: '#112233', props }),
      201,
    );
    expect(pin.color).toBe('#112233');
    expect((await get(map.id)).pins[0]?.props).toEqual(props);
  });

  it('rejects an unknown icon and too many tags', async () => {
    const map = await makeMap();
    for (const props of [
      { icon: 'nope' },
      { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
    ]) {
      await api.error(await t.call('POST', `/api/maps/${map.id}/pins`, { x: 0, y: 0, props }), 400);
    }
  });

  it('searches marker tags and status', async () => {
    const map = await makeMap();
    api.tick();
    await t.call('POST', `/api/maps/${map.id}/pins`, {
      x: 0,
      y: 0,
      label: 'A',
      props: { tags: ['seen'], status: 'blocked' },
    });
    const find = async (q: string) =>
      (
        (await (await t.call('GET', `/api/search?q=${q}`)).json()) as {
          groups: { maps: unknown[] };
        }
      ).groups.maps;
    expect(await find('blocked')).toHaveLength(1);
    expect(await find('seen')).toHaveLength(1);
  });
});

describe('one request saves sketch and pins together', () => {
  it('upserts and removes pins with the scene, atomically', async () => {
    const map = await makeMap();
    const a = newId();
    const b = newId();
    await changes(map.id, {
      scene: scene([rect('r')]),
      upsert: [
        { id: a, x: 1, y: 1, label: 'One' },
        { id: b, x: 2, y: 2, label: 'Two', props: { icon: 'star' } },
      ],
    });
    let now = await get(map.id);
    expect(now.pins.map((p) => p.label).sort()).toEqual(['One', 'Two']);
    await changes(map.id, { upsert: [{ id: a, x: 9, y: 9, label: 'One moved' }], remove: [b] });
    now = await get(map.id);
    expect(now.pins).toHaveLength(1);
    expect(now.pins[0]).toMatchObject({ x: 9, label: 'One moved' });
  });

  it('refuses a pin id that belongs to another map, and changes nothing', async () => {
    const one = await makeMap();
    const two = await makeMap();
    const id = newId();
    await changes(one.id, { upsert: [{ id, x: 0, y: 0 }] });
    await api.error(
      await t.call('POST', `/api/maps/${two.id}/changes`, {
        scene: scene([rect('x')]),
        upsert: [{ id, x: 0, y: 0 }],
      }),
      400,
    );
    expect((await get(two.id)).scene.shapes).toEqual([]);
  });

  it('restores a pin removed earlier (undo) with the same id', async () => {
    const map = await makeMap();
    const id = newId();
    await changes(map.id, { upsert: [{ id, x: 1, y: 1, label: 'Back' }] });
    await changes(map.id, { remove: [id] });
    await changes(map.id, { upsert: [{ id, x: 1, y: 1, label: 'Back' }] });
    expect((await get(map.id)).pins.map((p) => p.id)).toEqual([id]);
  });
});

describe('versions (AC-MAP-12)', () => {
  const versions = async (id: string) =>
    (await api.json<{ items: MapVersionInfo[] }>(await t.call('GET', `/api/maps/${id}/versions`)))
      .items;

  it('keeps the earlier state automatically, at most one every ten minutes', async () => {
    const map = await makeMap();
    await changes(map.id, { scene: scene([rect('a')]) });
    expect(await versions(map.id)).toEqual([]); // nothing worth keeping yet
    await changes(map.id, { scene: scene([rect('a'), rect('b')]) });
    let list = await versions(map.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'auto', shapes: 1, pins: 0 });
    await changes(map.id, { scene: scene([rect('a'), rect('b'), rect('c')]) });
    expect(await versions(map.id)).toHaveLength(1);
    t.clock.advance(11 * 60_000);
    await changes(map.id, { scene: scene([rect('a')]) });
    list = await versions(map.id);
    expect(list).toHaveLength(2);
    expect(list[0]?.shapes).toBe(3);
  });

  it('saves a named version on purpose and restores it, keeping what it replaces', async () => {
    const map = await makeMap();
    const pin = newId();
    await changes(map.id, {
      scene: scene([rect('a')]),
      upsert: [{ id: pin, x: 1, y: 1, label: 'Kept' }],
    });
    const saved = await api.json<{ items: MapVersionInfo[] }>(
      await t.call('POST', `/api/maps/${map.id}/versions`, { name: 'Before experiment' }),
      201,
    );
    const version = saved.items[0];
    expect(version).toMatchObject({
      name: 'Before experiment',
      kind: 'manual',
      shapes: 1,
      pins: 1,
    });
    await changes(map.id, { scene: scene([]), remove: [pin] });
    const back = await api.json<MapDetail>(
      await t.call('POST', `/api/maps/${map.id}/versions/${version?.id}/restore`),
    );
    expect(back.scene.shapes).toHaveLength(1);
    expect(back.pins.map((p) => p.label)).toEqual(['Kept']);
    const list = await versions(map.id);
    expect(list.some((v) => v.kind === 'restore' && v.shapes === 0)).toBe(true);
  });

  it('a restored pin loses a link to something deleted since, and keeps the pin', async () => {
    const map = await makeMap();
    const person = await api.person({ name: 'Someone' });
    const pin = newId();
    await changes(map.id, {
      upsert: [{ id: pin, x: 0, y: 0, target: { type: 'person', id: person.id } }],
    });
    const saved = await api.json<{ items: MapVersionInfo[] }>(
      await t.call('POST', `/api/maps/${map.id}/versions`, {}),
      201,
    );
    await t.call('DELETE', `/api/people/${person.id}`);
    const back = await api.json<MapDetail>(
      await t.call('POST', `/api/maps/${map.id}/versions/${saved.items[0]?.id}/restore`),
    );
    expect(back.pins).toHaveLength(1);
    expect(back.pins[0]?.target).toBeNull();
  });

  it('prunes automatic versions to thirty', async () => {
    const map = await makeMap();
    for (let i = 0; i < 35; i++) {
      t.clock.advance(11 * 60_000);
      await changes(map.id, {
        scene: scene(Array.from({ length: i + 1 }, (_, k) => rect(`r${k}`))),
      });
    }
    expect((await versions(map.id)).filter((v) => v.kind === 'auto').length).toBeLessThanOrEqual(
      30,
    );
  });

  it('deletes a version', async () => {
    const map = await makeMap();
    const saved = await api.json<{ items: MapVersionInfo[] }>(
      await t.call('POST', `/api/maps/${map.id}/versions`, { name: 'x' }),
      201,
    );
    expect(
      (await t.call('DELETE', `/api/maps/${map.id}/versions/${saved.items[0]?.id}`)).status,
    ).toBe(204);
    expect(await versions(map.id)).toEqual([]);
  });
});

describe('duplicate and project files (AC-MAP-13)', () => {
  it('duplicates a map with new pin ids and connectors that follow them', async () => {
    const map = await makeMap({ name: 'Town' });
    const pin = newId();
    await changes(map.id, {
      scene: scene([
        {
          id: 'c',
          layer: 'layer-1',
          t: 'connector',
          from: { pt: [0, 0], ref: pin },
          to: { pt: [9, 9] },
          route: 'straight',
          head: 'end',
          style: STYLE,
        },
      ]),
      upsert: [{ id: pin, x: 0, y: 0, label: 'Gate' }],
    });
    const copy = await api.json<MapDetail>(
      await t.call('POST', `/api/maps/${map.id}/duplicate`, {}),
      201,
    );
    expect(copy.name).toBe('Town copy');
    expect(copy.pins[0]?.id).not.toBe(pin);
    const shape = copy.scene.shapes[0];
    expect(shape?.t === 'connector' && shape.from.ref).toBe(copy.pins[0]?.id);
    // The original is untouched.
    expect((await get(map.id)).pins[0]?.id).toBe(pin);
  });

  it('exports an editable project file and imports it as a new map', async () => {
    const map = await makeMap({ name: 'Route' });
    const pin = newId();
    await changes(map.id, {
      scene: scene([rect('r', { name: 'Hall' })]),
      upsert: [{ id: pin, x: 3, y: 4, label: 'Start', props: { icon: 'flag' } }],
    });
    const res = await t.call('GET', `/api/maps/${map.id}/export.json`);
    expect(res.headers.get('content-disposition')).toMatch(/Route\.mossmap\.json/);
    const file = (await res.json()) as {
      format: string;
      scene: { shapes: unknown[] };
      pins: unknown[];
    };
    expect(file.format).toBe('mossnote-map');
    expect(file.scene.shapes).toHaveLength(1);
    const imported = await api.json<MapDetail>(await t.call('POST', '/api/maps/import', file), 201);
    expect(imported.id).not.toBe(map.id);
    expect(imported.name).toBe('Route');
    expect(imported.scene.shapes).toEqual((await get(map.id)).scene.shapes);
    expect(imported.pins[0]).toMatchObject({ label: 'Start', props: { icon: 'flag' } });
    expect(imported.pins[0]?.id).not.toBe(pin);
  });

  it('rejects a file that is not a map project', async () => {
    await api.error(await t.call('POST', '/api/maps/import', { hello: 'world' }), 400);
  });
});

describe('marker types (AC-MAP-14)', () => {
  const types = [
    { id: 'a', name: 'Important', icon: 'star', color: 'amber' },
    { id: 'b', name: 'Mine', icon: 'dot', color: '#445566' },
  ];
  it('start empty, save, and survive an export and import', async () => {
    const settings = async () =>
      (await (await t.call('GET', '/api/settings')).json()) as { markerTypes: unknown[] };
    expect((await settings()).markerTypes).toEqual([]);
    const keys = () =>
      (t.database.sqlite.prepare('SELECT key FROM settings').all() as { key: string }[]).map(
        (r) => r.key,
      );
    expect(keys()).not.toContain('markerTypes');
    expect((await t.call('PATCH', '/api/settings', { markerTypes: types })).status).toBe(200);
    expect((await settings()).markerTypes).toEqual(types);
    const exported = await (await t.call('GET', '/api/data/export.json')).json();
    await t.call('PATCH', '/api/settings', { markerTypes: [] });
    expect((await t.call('POST', '/api/data/import', exported)).status).toBe(200);
    expect((await settings()).markerTypes).toEqual(types);
  });

  it('rejects an unknown icon or an empty name', async () => {
    for (const bad of [
      { ...types[0], icon: 'nope' },
      { ...types[0], name: '  ' },
    ]) {
      expect((await t.call('PATCH', '/api/settings', { markerTypes: [bad] })).status).toBe(400);
    }
  });
});
