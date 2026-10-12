import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tag } from '@shared/types';
import { createCtx } from '../services/ctx';
import { reindexAll } from '../services/search-index';
import { Api } from '../testing/api';
import { makeTestApp, testConfig, type TestApp } from '../testing/app';

let t: TestApp;
let api: Api;
beforeEach(async () => {
  t = await makeTestApp();
  api = new Api(t);
});
afterEach(() => {
  api.expectIndexConsistent();
  t.close();
});

interface IndexRow {
  kind: string;
  ref_id: string;
  title: string;
  body: string;
  tags: string;
  extra: string;
}

const snapshot = (): IndexRow[] =>
  t.database.sqlite
    .prepare('SELECT kind, ref_id, title, body, tags, extra FROM search_fts ORDER BY kind, ref_id')
    .all() as IndexRow[];

/** What the index holds after a full rebuild from the tables: the answer every edit must match. */
const rebuilt = (): IndexRow[] => {
  const ctx = createCtx({
    db: t.database.db,
    sqlite: t.database.sqlite,
    clock: t.clock,
    config: testConfig(),
  });
  reindexAll(ctx);
  return snapshot();
};

const expectIndexMatchesRebuild = () => {
  const edited = snapshot();
  expect(edited).toEqual(rebuilt());
};

/** How many times the index was searched through to delete rows while `fn` ran. */
const indexDeletesDuring = async (fn: () => Promise<unknown>): Promise<number> => {
  const sqlite = t.database.sqlite as unknown as {
    prepare: (source: string) => { run: (...args: unknown[]) => unknown };
  };
  const original = sqlite.prepare.bind(sqlite);
  let runs = 0;
  sqlite.prepare = (source: string) => {
    const statement = original(source);
    if (/DELETE\s+FROM\s+search_fts/i.test(source)) {
      const run = statement.run.bind(statement);
      statement.run = (...args: unknown[]) => {
        runs++;
        return run(...args);
      };
    }
    return statement;
  };
  try {
    await fn();
  } finally {
    sqlite.prepare = original;
  }
  return runs;
};

const LINKED = 30;

/** A person and a farm entry, each mentioned by many notes, plus notes that mention neither. */
async function seed() {
  const person = await api.person({ name: 'Haley', tags: ['town'] });
  const planting = await api.planting({ label: 'Parsnips', tags: ['spring'] });
  for (let i = 0; i < LINKED; i++) {
    await api.note({
      body: `Linked note ${i}`,
      tags: i % 2 === 0 ? ['town'] : [],
      links: [
        { type: 'person', id: person.id },
        ...(i % 3 === 0 ? [{ type: 'planting', id: planting.id }] : []),
      ],
    });
  }
  for (let i = 0; i < 5; i++) await api.note({ body: `Unlinked note ${i}`, tags: ['town'] });
  return { person, planting };
}

describe('keeping the search index right when a record that others mention changes', () => {
  it('renaming a person updates the names every linked note is indexed with', async () => {
    const { person } = await seed();

    await t.call('PATCH', `/api/people/${person.id}`, { name: 'Haley Smith' });

    expectIndexMatchesRebuild();
    const linked = snapshot().filter((r) => r.kind === 'note' && r.extra.includes('Haley Smith'));
    expect(linked).toHaveLength(LINKED);
  });

  it('deleting a person removes the name from its notes, and restoring puts it back', async () => {
    const { person } = await seed();

    await t.call('DELETE', `/api/people/${person.id}`);
    expectIndexMatchesRebuild();
    expect(snapshot().some((r) => r.extra.includes('Haley'))).toBe(false);

    await t.call('POST', `/api/people/${person.id}/restore`);
    expectIndexMatchesRebuild();
    expect(snapshot().filter((r) => r.kind === 'note' && r.extra.includes('Haley'))).toHaveLength(
      LINKED,
    );
  });

  it('renaming, deleting and restoring a farm entry does the same for its notes', async () => {
    const { planting } = await seed();

    await t.call('PATCH', `/api/plantings/${planting.id}`, { label: 'Melons' });
    expectIndexMatchesRebuild();
    expect(snapshot().filter((r) => r.kind === 'note' && r.extra.includes('Melons')).length).toBe(
      10,
    );

    await t.call('DELETE', `/api/plantings/${planting.id}`);
    expectIndexMatchesRebuild();
    await t.call('POST', `/api/plantings/${planting.id}/restore`);
    expectIndexMatchesRebuild();
  });

  it('renaming a tag updates notes, people and farm entries that carry it', async () => {
    await seed();
    const tag = (await api.tags()).find((x: Tag) => x.name === 'town');
    if (!tag) throw new Error('No tag.');

    await t.call('PATCH', `/api/tags/${tag.id}`, { name: 'village' });

    expectIndexMatchesRebuild();
    const carrying = snapshot().filter((r) => r.tags.includes('village'));
    expect(carrying.filter((r) => r.kind === 'note')).toHaveLength(LINKED / 2 + 5);
    expect(carrying.filter((r) => r.kind === 'person')).toHaveLength(1);
    expect(snapshot().some((r) => r.tags.includes('town'))).toBe(false);
  });

  it('merging a tag into another and deleting a tag leave the index right', async () => {
    await seed();
    const tags = await api.tags();
    const town = tags.find((x: Tag) => x.name === 'town');
    const spring = tags.find((x: Tag) => x.name === 'spring');
    if (!town || !spring) throw new Error('No tags.');

    await t.call('POST', `/api/tags/${town.id}/merge`, { intoId: spring.id });
    expectIndexMatchesRebuild();

    await t.call('DELETE', `/api/tags/${spring.id}`);
    expectIndexMatchesRebuild();
    expect(snapshot().some((r) => r.tags.includes('spring') || r.tags.includes('town'))).toBe(
      false,
    );
  });
});

describe('the cost of those changes does not grow with the number of linked records', () => {
  it('renaming a person searches the index for deletions a fixed number of times, not once per note', async () => {
    const { person } = await seed();

    const deletes = await indexDeletesDuring(() =>
      t.call('PATCH', `/api/people/${person.id}`, { name: 'Haley Smith' }),
    );

    // the person's own row, then all linked notes together
    expect(deletes).toBeLessThanOrEqual(2);
  });

  it('deleting and restoring a farm entry does too', async () => {
    const { planting } = await seed();

    const deletes = await indexDeletesDuring(async () => {
      await t.call('DELETE', `/api/plantings/${planting.id}`);
      await t.call('POST', `/api/plantings/${planting.id}/restore`);
    });

    expect(deletes).toBeLessThanOrEqual(4);
  });

  it('renaming and deleting a tag do too', async () => {
    await seed();
    const tag = (await api.tags()).find((x: Tag) => x.name === 'town');
    if (!tag) throw new Error('No tag.');

    const renamed = await indexDeletesDuring(() =>
      t.call('PATCH', `/api/tags/${tag.id}`, { name: 'village' }),
    );
    const removed = await indexDeletesDuring(() => t.call('DELETE', `/api/tags/${tag.id}`));

    // one pass per kind of record at most: notes, people, farm entries
    expect(renamed).toBeLessThanOrEqual(3);
    expect(removed).toBeLessThanOrEqual(3);
  });
});
