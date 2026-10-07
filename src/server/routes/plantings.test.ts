import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encode } from '@shared/gameDate';
import type { Note, Page, Planting } from '@shared/types';
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

const k = (year: number, season: number, day: number) => encode({ year, season, day });
const list = async (query = '') =>
  api.json<Page<Planting>>(await t.call('GET', `/api/plantings${query}`));
const patch = (id: string, body: Record<string, unknown>) =>
  t.call('PATCH', `/api/plantings/${id}`, body);

describe('create', () => {
  it('AC-FRM-6: a fresh journal has no entries, and a label is enough', async () => {
    expect((await list()).items).toEqual([]);
    const entry = await api.planting({ label: 'Example entry' });
    expect(entry).toMatchObject({
      label: 'Example entry',
      plantedOn: null,
      harvestedOn: null,
      plantedCount: null,
      harvestedCount: null,
      notes: '',
      customFields: [],
      tags: [],
    });
  });

  it('is idempotent by id and allows duplicate names', async () => {
    const id = newId();
    await api.planting({ id, label: 'Once' });
    const again = await api.json<Planting>(
      await t.call('POST', '/api/plantings', { id, label: 'Twice' }),
      200,
    );
    expect(again.label).toBe('Once');
    await api.planting({ label: 'Once' });
    expect((await list()).items).toHaveLength(2);
  });

  it('requires a name of 1 to 80 characters', async () => {
    for (const label of ['', '  ']) {
      expect(
        (await api.error(await t.call('POST', '/api/plantings', { label }), 400)).message,
      ).toBe('Add a name.');
    }
    await api.error(await t.call('POST', '/api/plantings', { label: 'x'.repeat(81) }), 400);
    expect((await api.planting({ label: 'x'.repeat(80) })).label).toHaveLength(80);
  });
});

describe('dates and counts', () => {
  it('AC-FRM-3: a harvest date before the planted date is rejected with an inline message', async () => {
    const error = await api.error(
      await t.call('POST', '/api/plantings', {
        label: 'A',
        plantedOn: k(1, 1, 5),
        harvestedOn: k(1, 1, 4),
      }),
      400,
    );
    expect(error.message).toBe("Harvest can't be before planting.");
    expect(error.fields).toEqual({ harvestedOn: "Harvest can't be before planting." });
    const entry = await api.planting({ label: 'B', plantedOn: k(1, 1, 5) });
    await api.error(await patch(entry.id, { harvestedOn: k(1, 0, 1) }), 400);
    expect(
      (await api.json<Planting>(await patch(entry.id, { harvestedOn: k(1, 1, 5) }))).harvestedOn,
    ).toBe(k(1, 1, 5));
  });

  it('moving the planted date past an existing harvest date is refused', async () => {
    const entry = await api.planting({
      label: 'B',
      plantedOn: k(1, 0, 1),
      harvestedOn: k(1, 0, 9),
    });
    await api.error(await patch(entry.id, { plantedOn: k(1, 0, 10) }), 400);
  });

  it('both dates are optional; a harvest date alone is allowed', async () => {
    expect((await api.planting({ label: 'A', harvestedOn: k(1, 0, 3) })).harvestedOn).toBe(
      k(1, 0, 3),
    );
  });

  it('rejects dates that are not in the calendar', async () => {
    for (const plantedOn of [k(1, 0, 29), k(1, 9, 1), 3]) {
      const error = await api.error(
        await t.call('POST', '/api/plantings', { label: 'A', plantedOn }),
        400,
      );
      expect(error.message).toBe("That date isn't in your calendar.");
    }
  });

  it('AC-FRM-4: counts accept blanks and reject negative or non-integer values', async () => {
    const ok = await api.planting({ label: 'A', plantedCount: 0, harvestedCount: 999_999 });
    expect(ok).toMatchObject({ plantedCount: 0, harvestedCount: 999_999 });
    expect(
      (await api.json<Planting>(await patch(ok.id, { plantedCount: null }))).plantedCount,
    ).toBeNull();
    for (const bad of [-1, 1.5, 1_000_000, '3']) {
      const error = await api.error(await patch(ok.id, { plantedCount: bad }), 400);
      expect(error.message, String(bad)).toBe('Use a whole number from 0 to 999,999.');
    }
  });
});

describe('list and status groups', () => {
  it('AC-FRM-2: Growing, Done and Noted follow the dates, newest planted first', async () => {
    await api.planting({ label: 'noted' });
    await api.planting({ label: 'growing old', plantedOn: k(1, 0, 1) });
    const recent = await api.planting({ label: 'growing recent', plantedOn: k(1, 2, 1) });
    const done = await api.planting({ label: 'done', plantedOn: k(1, 1, 1) });
    await patch(done.id, { harvestedOn: k(1, 1, 9), harvestedCount: 4 });
    const names = async (q: string) => (await list(q)).items.map((p) => p.label);
    expect(await names('?status=growing')).toEqual(['growing recent', 'growing old']);
    expect(await names('?status=done')).toEqual(['done']);
    expect(await names('?status=noted')).toEqual(['noted']);
    expect(await names('')).toEqual(['growing recent', 'done', 'growing old', 'noted']);
    // Harvesting moves an entry from Growing to Done.
    await patch(recent.id, { harvestedOn: k(1, 2, 3) });
    expect(await names('?status=growing')).toEqual(['growing old']);
    expect(await names('?status=done')).toEqual(['growing recent', 'done']);
  });

  it('filters by tag and pages', async () => {
    for (let i = 0; i < 4; i++)
      await api.planting({ label: `E${i}`, plantedOn: k(1, 0, i + 1), tags: i < 2 ? ['x'] : [] });
    expect((await list('?tag=x')).items.map((p) => p.label)).toEqual(['E1', 'E0']);
    const first = await list('?limit=3');
    expect(first.items).toHaveLength(3);
    const second = await list(`?limit=3&cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(1);
  });
});

describe('list limits', () => {
  it('accepts up to 500 (the web app asks for 500) and rejects more', async () => {
    await api.planting({ label: 'A' });
    expect((await list('?limit=500&status=growing')).items).toHaveLength(0);
    expect((await list('?limit=500')).items).toHaveLength(1);
    await api.error(await t.call('GET', '/api/plantings?limit=501'), 400);
  });
});

describe('delete, restore, backlinks', () => {
  it('soft delete hides the entry, its note chips and backlinks; undo restores them', async () => {
    const entry = await api.planting({ label: 'Example entry', tags: ['t'] });
    const note = await api.note({ body: 'about it', links: [{ type: 'planting', id: entry.id }] });
    const back = await api.json<Page<Note>>(
      await t.call('GET', `/api/plantings/${entry.id}/notes`),
    );
    expect(back.items.map((n) => n.id)).toEqual([note.id]);

    await t.call('DELETE', `/api/plantings/${entry.id}`);
    expect((await list()).items).toEqual([]);
    expect((await api.getNote(note.id)).links).toEqual([]);
    await api.error(await t.call('GET', `/api/plantings/${entry.id}/notes`), 404);

    const restored = await api.json<Planting>(
      await t.call('POST', `/api/plantings/${entry.id}/restore`),
    );
    expect(restored.tags).toEqual(['t']);
    expect((await api.getNote(note.id)).links.map((l) => l.label)).toEqual(['Example entry']);
  });

  it('renaming an entry changes the label on every chip', async () => {
    const entry = await api.planting({ label: 'Old' });
    const note = await api.note({ body: 'x', links: [{ type: 'planting', id: entry.id }] });
    await patch(entry.id, { label: 'New' });
    expect((await api.getNote(note.id)).links[0]?.label).toBe('New');
  });

  it('returns 409 for a stale edit and offers custom field labels', async () => {
    const entry = await api.planting({
      label: 'A',
      customFields: [{ label: 'Spot', value: 'north' }],
    });
    await patch(entry.id, { notes: 'changed' });
    const error = await api.error(
      await patch(entry.id, { notes: 'mine', expectedUpdatedAt: entry.updatedAt }),
      409,
    );
    expect(error.code).toBe('conflict');
    const labels = await api.json<{ labels: string[] }>(
      await t.call('GET', '/api/field-labels?kind=planting&q=sp'),
    );
    expect(labels.labels).toEqual(['Spot']);
    const none = await api.json<{ labels: string[] }>(
      await t.call('GET', '/api/field-labels?kind=person&q=sp'),
    );
    expect(none.labels).toEqual([]);
  });
});
