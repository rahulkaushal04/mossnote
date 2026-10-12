import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  MapDetail,
  MapPin,
  MapSummary,
  Page,
  PinRef,
  SearchResponse,
  TrashItem,
} from '@shared/types';
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
const sceneOf = (shapes: unknown[]) => ({
  v: 2,
  layers: [{ id: 'layer-1', name: 'Layer 1' }],
  shapes,
});
const path = (id: string, pts: number[][]) => ({
  id,
  layer: 'layer-1',
  t: 'path',
  pts,
  style: STYLE,
});
const text = (id: string, value: string) => ({
  id,
  layer: 'layer-1',
  t: 'text',
  x: 5,
  y: 5,
  text: value,
  size: 16,
  kind: 'plain',
  style: STYLE,
});

interface Places {
  items: (MapPin & { mapName: string })[];
  nextCursor: string | null;
}

const makeMap = async (body: Record<string, unknown> = {}) => {
  api.tick();
  return api.json<MapDetail>(await t.call('POST', '/api/maps', body), 201);
};
const getMap = async (id: string) => api.json<MapDetail>(await t.call('GET', `/api/maps/${id}`));
const addPin = async (mapId: string, body: Record<string, unknown>) => {
  api.tick();
  return api.json<MapPin>(await t.call('POST', `/api/maps/${mapId}/pins`, body), 201);
};

describe('maps', () => {
  it('starts empty, and a map needs no name', async () => {
    expect((await api.json<Page<MapSummary>>(await t.call('GET', '/api/maps'))).items).toEqual([]);
    const map = await makeMap();
    expect(map).toMatchObject({ name: 'Untitled map', pins: [], pinCount: 0 });
    expect(map.scene).toEqual({ v: 2, layers: [{ id: 'layer-1', name: 'Layer 1' }], shapes: [] });
  });

  it('refuses a create whose id belongs to a deleted map', async () => {
    const id = newId();
    await t.call('POST', '/api/maps', { id, name: 'Gone' });
    await t.call('DELETE', `/api/maps/${id}`);

    const res = await t.call('POST', '/api/maps', { id, name: 'Again' });

    expect((await api.error(res, 409)).code).toBe('conflict');
  });

  it('refuses a duplicate whose id belongs to a deleted map', async () => {
    const source = await api.json<{ id: string }>(
      await t.call('POST', '/api/maps', { name: 'Source' }),
      201,
    );
    const id = newId();
    await t.call('POST', '/api/maps', { id, name: 'Gone' });
    await t.call('DELETE', `/api/maps/${id}`);

    const res = await t.call('POST', `/api/maps/${source.id}/duplicate`, { id });

    expect((await api.error(res, 409)).code).toBe('conflict');
  });

  it('create is idempotent by id', async () => {
    const id = newId();
    await makeMap({ id, name: 'Once' });
    const again = await api.json<MapDetail>(
      await t.call('POST', '/api/maps', { id, name: 'Twice' }),
      200,
    );
    expect(again.name).toBe('Once');
  });

  it('saves the sketch and refuses a stale save', async () => {
    const map = await makeMap({ name: 'Lake' });
    const scene = sceneOf([
      path('a', [
        [0, 0],
        [10, 10],
      ]),
      text('b', 'shore'),
      {
        id: 'c',
        layer: 'layer-1',
        t: 'connector',
        from: { pt: [0, 0] },
        to: { pt: [4, 4] },
        route: 'straight',
        head: 'end',
        style: STYLE,
      },
      {
        id: 'd',
        layer: 'layer-1',
        t: 'polygon',
        pts: [
          [0, 0],
          [5, 0],
          [5, 5],
        ],
        style: STYLE,
      },
    ]);
    api.tick();
    const saved = await api.json<MapDetail>(
      await t.call('PATCH', `/api/maps/${map.id}`, { scene, expectedUpdatedAt: map.updatedAt }),
    );
    expect(saved.scene).toEqual(scene);
    const stale = await api.error(
      await t.call('PATCH', `/api/maps/${map.id}`, { name: 'x', expectedUpdatedAt: map.updatedAt }),
      409,
    );
    expect(stale.code).toBe('conflict');
  });

  it('rejects a malformed sketch', async () => {
    const map = await makeMap();
    const bad = (shape: Record<string, unknown>) => sceneOf([{ ...path('a', [[0, 0]]), ...shape }]);
    for (const scene of [
      bad({ style: { ...STYLE, stroke: 'puce' } }),
      bad({ pts: [] }),
      bad({ layer: '' }),
      bad({ extra: true }),
      sceneOf([{ ...text('t', ''), text: '' }]),
      { ...sceneOf([]), layers: [] },
      [{ id: 'a', t: 'stroke', color: 'ink', w: 3, pts: [[0, 0]] }],
    ]) {
      await api.error(await t.call('PATCH', `/api/maps/${map.id}`, { scene }), 400);
    }
  });

  it('deleting hides the map, restore brings it and its pins back', async () => {
    const map = await makeMap({ name: 'Keep' });
    await addPin(map.id, { x: 1, y: 2, label: 'Spot' });
    expect((await t.call('DELETE', `/api/maps/${map.id}`)).status).toBe(204);
    expect((await t.call('GET', `/api/maps/${map.id}`)).status).toBe(404);
    const trash = await api.json<{ items: TrashItem[] }>(await t.call('GET', '/api/trash'));
    expect(trash.items).toMatchObject([{ kind: 'map', id: map.id, label: 'Keep' }]);
    const back = await api.json<MapDetail>(
      await t.call('POST', `/api/trash/map/${map.id}/restore`),
    );
    expect(back.pins).toHaveLength(1);
  });
});

describe('pins', () => {
  it('a pin needs only a place on the map', async () => {
    const map = await makeMap();
    const pin = await addPin(map.id, { x: 12.5, y: -3 });
    expect(pin).toMatchObject({ x: 12.5, y: -3, label: '', note: '', target: null, color: 'moss' });
    expect((await getMap(map.id)).pinCount).toBe(1);
  });

  it('links a pin to a note, a person or a farm entry, and shows the label', async () => {
    const map = await makeMap({ name: 'Shore' });
    const note = await api.note({ title: 'Odd stone', body: '' });
    const person = await api.person({ name: 'Someone' });
    const planting = await api.planting({ label: 'Row one' });
    const a = await addPin(map.id, { x: 0, y: 0, target: { type: 'note', id: note.id } });
    const b = await addPin(map.id, { x: 1, y: 1, target: { type: 'person', id: person.id } });
    const c = await addPin(map.id, { x: 2, y: 2, target: { type: 'planting', id: planting.id } });
    expect(a.target).toEqual({ type: 'note', id: note.id, label: 'Odd stone' });
    expect(b.target?.label).toBe('Someone');
    expect(c.target?.label).toBe('Row one');
    const onMaps = await api.json<{ items: PinRef[] }>(
      await t.call('GET', `/api/maps/pins?type=note&id=${note.id}`),
    );
    expect(onMaps.items).toEqual([{ pinId: a.id, mapId: map.id, mapName: 'Shore', label: '' }]);
  });

  it('refuses a link to something that does not exist', async () => {
    const map = await makeMap();
    await api.error(
      await t.call('POST', `/api/maps/${map.id}/pins`, {
        x: 0,
        y: 0,
        target: { type: 'note', id: newId() },
      }),
      400,
    );
  });

  it('a deleted target hides the chip; deleting forever clears it', async () => {
    const map = await makeMap();
    const person = await api.person({ name: 'Gone soon' });
    const pin = await addPin(map.id, { x: 0, y: 0, target: { type: 'person', id: person.id } });
    await t.call('DELETE', `/api/people/${person.id}`);
    expect((await getMap(map.id)).pins[0]?.target).toBeNull();
    await t.call('POST', `/api/people/${person.id}/restore`);
    expect((await getMap(map.id)).pins[0]?.target?.label).toBe('Gone soon');
    await t.call('DELETE', `/api/people/${person.id}`);
    await t.call('DELETE', `/api/trash/person/${person.id}`);
    const after = (await getMap(map.id)).pins.find((p) => p.id === pin.id);
    expect(after?.target).toBeNull();
  });

  it('moves, edits and unlinks a pin, then deletes it', async () => {
    const map = await makeMap();
    const note = await api.note({ body: 'hello' });
    const pin = await addPin(map.id, { x: 0, y: 0, target: { type: 'note', id: note.id } });
    const moved = await api.json<MapPin>(
      await t.call('PATCH', `/api/maps/${map.id}/pins/${pin.id}`, {
        x: 9,
        label: 'Here',
        note: 'came back later',
        color: 'rose',
        target: null,
      }),
    );
    expect(moved).toMatchObject({ x: 9, y: 0, label: 'Here', color: 'rose', target: null });
    expect((await t.call('DELETE', `/api/maps/${map.id}/pins/${pin.id}`)).status).toBe(204);
    expect((await getMap(map.id)).pins).toEqual([]);
  });

  it('caps pins at 500 per map', async () => {
    const map = await makeMap();
    const insert = t.database.sqlite.prepare(
      'INSERT INTO map_pins (id, map_id, x, y, created_at, updated_at) VALUES (?, ?, 0, 0, 1, 1)',
    );
    for (let i = 0; i < 500; i++) insert.run(newId(), map.id);
    await api.error(await t.call('POST', `/api/maps/${map.id}/pins`, { x: 0, y: 0 }), 400);
  });
});

describe('text stored for maps is normalised like all other stored text', () => {
  /** CRLF and NUL, which the rule for stored text removes. */
  const DIRTY = 'nul\u0000x\r\ny';
  const CLEAN = 'nulx\ny';
  const dirtyShape = () => ({
    ...text('t1', 'a\r\nb\u0000c'),
    name: 'sh\u0000ape',
    note: 'no\r\nte',
  });
  const dirtyScene = () => ({
    v: 2,
    layers: [{ id: 'layer-1', name: ' Lay\u0000er\r\n1 ' }],
    shapes: [dirtyShape()],
    scale: { unit: ' m\u0000i ', size: 5 },
  });
  const expectCleanScene = (scene: MapDetail['scene']) => {
    expect(scene.layers[0]?.name).toBe('Layer\n1');
    const shape = scene.shapes[0] as { text: string; name: string; note: string };
    expect(shape).toMatchObject({ text: 'a\nbc', name: 'shape', note: 'no\nte' });
    expect(scene.scale?.unit).toBe('mi');
  };

  it('cleans a pin label when the pin is made, changed or saved with the sketch', async () => {
    const map = await makeMap();
    const made = await addPin(map.id, { x: 0, y: 0, label: `  ${DIRTY}  `, note: DIRTY });
    expect(made.label).toBe(CLEAN);
    expect(made.note).toBe(CLEAN);

    const patched = await api.json<MapPin>(
      await t.call('PATCH', `/api/maps/${map.id}/pins/${made.id}`, { label: 'x\u0000\r\n y ' }),
    );
    expect(patched.label).toBe('x\n y');

    const id = newId();
    api.tick();
    await api.json(
      await t.call('POST', `/api/maps/${map.id}/changes`, {
        upsert: [{ id, x: 1, y: 1, label: DIRTY }],
      }),
    );
    expect((await getMap(map.id)).pins.find((p) => p.id === id)?.label).toBe(CLEAN);
  });

  it('cleans pin status, tags and field text', async () => {
    const map = await makeMap();
    const pin = await addPin(map.id, {
      x: 0,
      y: 0,
      props: {
        status: ' Do\u0000ne\r\n',
        tags: [' no\u0000rth '],
        fields: [{ label: 'K\u0000', value: 'v\r\nw' }],
      },
    });
    expect(pin.props).toEqual({
      status: 'Done',
      tags: ['north'],
      fields: [{ label: 'K', value: 'v\nw' }],
    });
  });

  it('cleans the text of a sketch: layer names, text, object names and notes, and the scale unit', async () => {
    const map = await makeMap();
    api.tick();
    const patched = await api.json<MapDetail>(
      await t.call('PATCH', `/api/maps/${map.id}`, { scene: dirtyScene() }),
    );
    expectCleanScene(patched.scene);
    expectCleanScene((await getMap(map.id)).scene);

    api.tick();
    await api.json(await t.call('POST', `/api/maps/${map.id}/changes`, { scene: dirtyScene() }));
    expectCleanScene((await getMap(map.id)).scene);
  });

  it('cleans marker type names and version names', async () => {
    const settings = await api.json<{ markerTypes: { name: string }[] }>(
      await t.call('PATCH', '/api/settings', {
        markerTypes: [{ id: 'm1', name: ' Ca\u0000mp\r\n ', icon: 'star', color: 'moss' }],
      }),
    );
    expect(settings.markerTypes[0]?.name).toBe('Camp');
    const map = await makeMap();
    const saved = await api.json<{ items: { name: string }[] }>(
      await t.call('POST', `/api/maps/${map.id}/versions`, { name: ' Be\u0000fore\r\n ' }),
      201,
    );
    expect(saved.items.map((v) => v.name)).toContain('Before');
  });

  it('refuses text that is nothing once cleaned, and text that is still too long', async () => {
    const map = await makeMap();
    api.tick();
    const empty = { ...dirtyScene(), shapes: [text('t1', '\u0000\u0000')] };
    expect((await t.call('PATCH', `/api/maps/${map.id}`, { scene: empty })).status).toBe(400);
    const long = { ...dirtyScene(), shapes: [{ ...dirtyShape(), name: 'n'.repeat(81) }] };
    expect((await t.call('PATCH', `/api/maps/${map.id}`, { scene: long })).status).toBe(400);
    const noteTooLong = { ...dirtyScene(), shapes: [{ ...dirtyShape(), note: 'n'.repeat(501) }] };
    expect((await t.call('PATCH', `/api/maps/${map.id}`, { scene: noteTooLong })).status).toBe(400);
    const justFits = {
      ...dirtyScene(),
      shapes: [{ ...dirtyShape(), name: `${'n'.repeat(80)}\u0000` }],
    };
    expect((await t.call('PATCH', `/api/maps/${map.id}`, { scene: justFits })).status).toBe(200);
  });

  it('cleans a map project file as it is opened', async () => {
    const project = {
      format: 'mossnote-map',
      formatVersion: 1,
      name: 'Opened',
      scene: dirtyScene(),
      pins: [{ id: newId(), x: 0, y: 0, label: DIRTY, color: 'moss', note: DIRTY, props: {} }],
    };
    const opened = await api.json<MapDetail>(
      await t.call('POST', '/api/maps/import', project),
      201,
    );
    expectCleanScene(opened.scene);
    expect(opened.pins[0]?.label).toBe(CLEAN);
  });

  it('does not change anything when a journal is exported and imported again', async () => {
    const map = await makeMap({ name: 'Round trip' });
    await addPin(map.id, {
      x: 0,
      y: 0,
      label: DIRTY,
      note: DIRTY,
      props: { status: 'Do\u0000ne', tags: ['no\u0000rth'] },
    });
    api.tick();
    await t.call('PATCH', `/api/maps/${map.id}`, { scene: dirtyScene() });

    const exportOnce = async () =>
      JSON.parse(await (await t.call('GET', '/api/data/export.json')).text()) as {
        exportedAt: string;
      };
    const sameButTime = (file: { exportedAt: string }) => ({ ...file, exportedAt: 'x' });
    const first = await exportOnce();
    const imported = await t.call('POST', '/api/data/import', first);
    expect(imported.status).toBe(200);
    expect(sameButTime(await exportOnce())).toEqual(sameButTime(first));
    expect(JSON.stringify(first)).not.toMatch(/\\u0000|\\r/);
  });
});

describe('map search ignores case and accents, and matches only what a person wrote', () => {
  const findMaps = async (q: string, limit?: number) =>
    (
      await api.json<SearchResponse>(
        await t.call(
          'GET',
          `/api/search?q=${encodeURIComponent(q)}&kinds=map${limit === undefined ? '' : `&limit=${limit}`}`,
        ),
      )
    ).groups.maps;
  const rect = (id: string) => ({
    id,
    layer: 'layer-1',
    t: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    style: STYLE,
  });
  const setScene = async (id: string, shapes: unknown[]) => {
    api.tick();
    await t.call('PATCH', `/api/maps/${id}`, { scene: sceneOf(shapes) });
  };

  it('finds an accented pin label and pin note in any casing, with or without accents', async () => {
    const map = await makeMap({ name: 'Valley' });
    await addPin(map.id, { x: 0, y: 0, label: 'Élise cabin', note: 'Café by the river' });
    for (const q of ['Élise cabin', 'élise cabin', 'elise cabin', 'ÉLISE CABIN', 'ELISE CABIN']) {
      expect(
        (await findMaps(q)).map((h) => h.title),
        q,
      ).toEqual(['Élise cabin']);
    }
    for (const q of ['café', 'cafe', 'CAFÉ', 'CAFE']) {
      expect(
        (await findMaps(q)).map((h) => h.title),
        q,
      ).toEqual(['Élise cabin']);
    }
  });

  it('finds an accented map name and accented text and names on the sketch', async () => {
    const named = await makeMap({ name: 'Östersund trip' });
    const sketched = await makeMap({ name: 'Plain' });
    await setScene(sketched.id, [text('t1', 'Zürich station')]);
    expect((await findMaps('ostersund')).map((h) => h.mapId)).toEqual([named.id]);
    expect((await findMaps('ÖSTERSUND')).map((h) => h.mapId)).toEqual([named.id]);
    const hits = await findMaps('zurich');
    expect(hits.map((h) => h.mapId)).toEqual([sketched.id]);
    expect(hits[0]?.snippet).toBe('Zürich station');
  });

  it('finds pin status, tags and field values, but not the names of the settings they sit in', async () => {
    const map = await makeMap({ name: 'Valley' });
    await addPin(map.id, {
      x: 0,
      y: 0,
      label: 'Gate',
      props: {
        icon: 'star',
        status: 'Locked up',
        tags: ['Nörth'],
        fields: [{ label: 'Keeper', value: 'Ångström' }],
      },
    });
    await addPin(map.id, { x: 1, y: 1, label: 'Plain', props: { locked: true, layer: 'layer-1' } });
    for (const q of ['locked up', 'north', 'angstrom', 'keeper']) {
      expect(
        (await findMaps(q)).map((h) => h.title),
        q,
      ).toEqual(['Gate']);
    }
    // Words that are only the names of settings, or their values, are not text anyone wrote.
    for (const q of ['icon', 'status', 'tags', 'fields', 'true', 'layer', 'star']) {
      expect(await findMaps(q), q).toEqual([]);
    }
  });

  it('does not let maps that only contain the word in their data hide the one that has it as text', async () => {
    const old = await makeMap({ name: 'Old notes' });
    await setScene(old.id, [text('t1', 'Correct route to the mine')]);
    for (let i = 0; i < 8; i++) {
      const sketch = await makeMap({ name: `Sketch ${i}` });
      await setScene(sketch.id, [rect('r1')]);
    }
    // "rect" is in the stored sketch of every newer map, as the name of its shape type.
    const hits = await findMaps('rect', 3);
    expect(hits.map((h) => h.mapId)).toEqual([old.id]);
    expect(hits[0]?.snippet).toBe('Correct route to the mine');
  });

  it('matches sketch text that has a backslash in it, as written', async () => {
    const map = await makeMap({ name: 'Notes' });
    await setScene(map.id, [text('t1', 'north\\gate and "quoted" words')]);
    // The stored JSON spells the backslash as two, so matching it as text would miss this.
    expect((await findMaps('north\\gate')).map((h) => h.mapId)).toEqual([map.id]);
    expect((await findMaps('quoted')).map((h) => h.mapId)).toEqual([map.id]);
  });

  it('keeps maps in the trash and their pins out of the results', async () => {
    const map = await makeMap({ name: 'Gone' });
    await addPin(map.id, { x: 0, y: 0, label: 'Élise cabin' });
    await t.call('DELETE', `/api/maps/${map.id}`);
    expect(await findMaps('elise')).toEqual([]);
    expect(await findMaps('gone')).toEqual([]);
  });
});

describe('search and places', () => {
  it('finds maps by name, pin label, pin note and a typed label', async () => {
    const map = await makeMap({ name: 'Riverside' });
    await addPin(map.id, { x: 0, y: 0, label: 'Strange gate', note: 'locked for now' });
    api.tick();
    await t.call('PATCH', `/api/maps/${map.id}`, {
      scene: sceneOf([text('l', 'old bridge')]),
    });
    const find = async (q: string) =>
      (
        await api.json<SearchResponse>(
          await t.call('GET', `/api/search?q=${encodeURIComponent(q)}`),
        )
      ).groups.maps;
    expect((await find('river')).map((h) => h.pinId)).toEqual([null]);
    expect((await find('gate')).map((h) => h.title)).toEqual(['Strange gate']);
    expect((await find('locked'))[0]?.snippet).toBe('locked for now');
    expect((await find('bridge'))[0]?.snippet).toBe('old bridge');
    expect(await find('#sometag river')).toEqual([]);
  });

  it('pages the maps list, newest first, with no map missing or repeated', async () => {
    const made: string[] = [];
    for (let i = 0; i < 5; i++) made.push((await makeMap({ name: `Map ${i}` })).id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<MapSummary> = await api.json(
        await t.call('GET', `/api/maps?limit=2${cursor ? `&cursor=${cursor}` : ''}`),
      );
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((m) => m.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...made].reverse());
  });

  it('pages places past 500, newest first, with no pin missing or repeated', async () => {
    const a = await makeMap({ name: 'A' });
    const b = await makeMap({ name: 'B' });
    const batch = (prefix: string) =>
      Array.from({ length: 300 }, (_, i) => ({ id: newId(), x: i, y: i, label: `${prefix}${i}` }));
    for (const [map, prefix] of [
      [a, 'a'],
      [b, 'b'],
    ] as const) {
      api.tick();
      await api.json(
        await t.call('POST', `/api/maps/${map.id}/changes`, { upsert: batch(prefix) }),
      );
    }

    const first = await api.json<Places>(await t.call('GET', '/api/maps/places'));
    expect(first.items).toHaveLength(500);
    expect(first.nextCursor).not.toBeNull();
    const second = await api.json<Places>(
      await t.call('GET', `/api/maps/places?cursor=${first.nextCursor}`),
    );
    expect(second.items).toHaveLength(100);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((p) => p.id);
    expect(new Set(ids).size).toBe(600);
  });

  it('refuses a places cursor that is not one', async () => {
    expect((await t.call('GET', '/api/maps/places?cursor=nope')).status).toBe(400);
  });

  it('lists every pin across maps as places', async () => {
    const a = await makeMap({ name: 'A' });
    const b = await makeMap({ name: 'B' });
    await addPin(a.id, { x: 0, y: 0, label: 'one' });
    await addPin(b.id, { x: 0, y: 0, label: 'two' });
    const places = await api.json<{ items: (MapPin & { mapName: string })[] }>(
      await t.call('GET', '/api/maps/places'),
    );
    expect(places.items.map((p) => `${p.mapName}:${p.label}`).sort()).toEqual(['A:one', 'B:two']);
  });
});
