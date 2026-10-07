import type { Page, Person } from '@shared/types';
import type { PersonCreate, PersonListQuery, PersonPatch } from '@shared/schemas/person';
import { normalizeTag } from '@shared/tags';
import { notFound, validationFailed } from '../errors';
import { first, inTx, iso, offsetFromCursor, pageOf, type Ctx } from './ctx';
import { assertFresh, nextUpdatedAt, parseFields, serializeFields } from './records';
import { reindex, reindexLinkedNotes, unindex } from './search-index';
import { resolveTagIds, setTagIds, tagNames } from './tags';

interface PersonRow {
  id: string;
  name: string;
  notes: string;
  progress: number | null;
  progress_max: number | null;
  custom_fields: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export function toPeople(ctx: Ctx, rows: readonly PersonRow[]): Person[] {
  const tags = tagNames(
    ctx,
    'person',
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    notes: r.notes,
    progress: r.progress,
    progressMax: r.progress_max,
    customFields: parseFields(r.custom_fields),
    tags: tags.get(r.id) ?? [],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }));
}

function loadRow(ctx: Ctx, id: string, includeDeleted = false): PersonRow {
  const row = ctx.sqlite.prepare('SELECT * FROM people WHERE id = ?').get(id) as
    PersonRow | undefined;
  if (!row || (!includeDeleted && row.deleted_at !== null))
    throw notFound('That person is not here.');
  return row;
}

const one = (ctx: Ctx, id: string): Person => first(toPeople(ctx, [loadRow(ctx, id)]));

export const getPerson = (ctx: Ctx, id: string): Person => one(ctx, id);

const LIST_BY_NAME = `
  SELECT p.* FROM people p WHERE p.deleted_at IS NULL
    AND (? IS NULL OR EXISTS (SELECT 1 FROM person_tags x JOIN tags t ON t.id = x.tag_id
                               WHERE x.person_id = p.id AND t.name_key = ?))
  ORDER BY p.name COLLATE NOCASE, p.id LIMIT ? OFFSET ?`;
const LIST_BY_UPDATED = `
  SELECT p.* FROM people p WHERE p.deleted_at IS NULL
    AND (? IS NULL OR EXISTS (SELECT 1 FROM person_tags x JOIN tags t ON t.id = x.tag_id
                               WHERE x.person_id = p.id AND t.name_key = ?))
  ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`;

export function listPeople(ctx: Ctx, query: PersonListQuery): Page<Person> {
  const offset = offsetFromCursor(query.cursor);
  const tag = query.tag === undefined ? null : normalizeTag(query.tag);
  const key = tag === null ? null : tag.ok ? tag.key : '\u0000no-such-tag';
  const rows = ctx.sqlite
    .prepare(query.sort === 'name' ? LIST_BY_NAME : LIST_BY_UPDATED)
    .all(key, key, query.limit + 1, offset) as PersonRow[];
  const { items, nextCursor } = pageOf(rows, query.limit, offset);
  return { items: toPeople(ctx, items), nextCursor };
}

const PROGRESS_TOO_HIGH = "Progress can't be higher than the maximum.";

function checkProgress(progress: number | null, max: number | null): void {
  if (progress !== null && max === null) {
    throw validationFailed(PROGRESS_TOO_HIGH, { progress: 'Set a maximum first.' });
  }
  if (progress !== null && max !== null && progress > max) {
    throw validationFailed(PROGRESS_TOO_HIGH, { progress: PROGRESS_TOO_HIGH });
  }
}

export function createPerson(ctx: Ctx, input: PersonCreate): { person: Person; created: boolean } {
  return inTx(ctx, () => {
    if (input.id) {
      const existing = ctx.sqlite.prepare('SELECT * FROM people WHERE id = ?').get(input.id) as
        PersonRow | undefined;
      if (existing) return { person: first(toPeople(ctx, [existing])), created: false };
    }
    const progress = input.progress ?? null;
    const progressMax = input.progressMax ?? null;
    checkProgress(progress, progressMax);
    const tagIds = resolveTagIds(ctx, 'person', input.tags ?? []);
    const id = input.id ?? ctx.newId();
    const now = ctx.clock.now();
    ctx.sqlite
      .prepare(
        `INSERT INTO people (id, name, notes, progress, progress_max, custom_fields, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.notes ?? '',
        progress,
        progressMax,
        serializeFields(input.customFields ?? []),
        now,
        now,
      );
    setTagIds(ctx, 'person', id, tagIds);
    reindex(ctx, 'person', id);
    return { person: one(ctx, id), created: true };
  });
}

export function patchPerson(ctx: Ctx, id: string, patch: PersonPatch): Person {
  return inTx(ctx, () => {
    const row = loadRow(ctx, id);
    assertFresh(patch.expectedUpdatedAt, row.updated_at, () => one(ctx, id), 'person');
    const progressMax = patch.progressMax === undefined ? row.progress_max : patch.progressMax;
    const progress = patch.progress === undefined ? row.progress : patch.progress;
    checkProgress(progress, progressMax);
    const tagIds = patch.tags === undefined ? null : resolveTagIds(ctx, 'person', patch.tags);
    const renamed = patch.name !== undefined && patch.name !== row.name;
    ctx.sqlite
      .prepare(
        `UPDATE people SET name = ?, notes = ?, progress = ?, progress_max = ?, custom_fields = ?,
           updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.name ?? row.name,
        patch.notes ?? row.notes,
        progress,
        progressMax,
        patch.customFields === undefined ? row.custom_fields : serializeFields(patch.customFields),
        nextUpdatedAt(ctx, row.updated_at),
        id,
      );
    if (tagIds) setTagIds(ctx, 'person', id, tagIds);
    reindex(ctx, 'person', id);
    if (renamed) reindexLinkedNotes(ctx, id);
    return one(ctx, id);
  });
}

/** Soft delete. Notes that mention the person stay; their chips for this person are hidden. */
export function deletePerson(ctx: Ctx, id: string): void {
  inTx(ctx, () => {
    const row = loadRow(ctx, id, true);
    if (row.deleted_at !== null) return;
    ctx.sqlite.prepare('UPDATE people SET deleted_at = ? WHERE id = ?').run(ctx.clock.now(), id);
    unindex(ctx, 'person', id);
    reindexLinkedNotes(ctx, id);
  });
}

export function restorePerson(ctx: Ctx, id: string): Person {
  return inTx(ctx, () => {
    const row = loadRow(ctx, id, true);
    if (row.deleted_at !== null) {
      ctx.sqlite.prepare('UPDATE people SET deleted_at = NULL WHERE id = ?').run(id);
      reindex(ctx, 'person', id);
      reindexLinkedNotes(ctx, id);
    }
    return one(ctx, id);
  });
}
