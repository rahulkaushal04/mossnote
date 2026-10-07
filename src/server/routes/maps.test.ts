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
