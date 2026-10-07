import { LIMITS } from '@shared/constants';
import { normalizeTag, normalizeTags } from '@shared/tags';
import type { Tag } from '@shared/types';
import { AppError, notFound, validationFailed } from '../errors';
import { inTx, type Ctx } from './ctx';
import { reindex, reindexTagged } from './search-index';

export type TagKind = 'note' | 'person' | 'planting';

const KIND_WORD: Record<TagKind, string> = { note: 'note', person: 'person', planting: 'entry' };

// Statements per kind. Table and column names never come from input.
const REMOVE: Record<TagKind, string> = {
  note: 'DELETE FROM note_tags WHERE note_id = ?',
  person: 'DELETE FROM person_tags WHERE person_id = ?',
  planting: 'DELETE FROM planting_tags WHERE planting_id = ?',
};
const ADD: Record<TagKind, string> = {
  note: 'INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)',
  person: 'INSERT INTO person_tags (person_id, tag_id) VALUES (?, ?)',
  planting: 'INSERT INTO planting_tags (planting_id, tag_id) VALUES (?, ?)',
};
const NAMES: Record<TagKind, string> = {
  note: `SELECT x.note_id AS id, t.name AS name FROM note_tags x JOIN tags t ON t.id = x.tag_id
         WHERE x.note_id IN (SELECT value FROM json_each(?)) ORDER BY t.name_key`,
  person: `SELECT x.person_id AS id, t.name AS name FROM person_tags x JOIN tags t ON t.id = x.tag_id
         WHERE x.person_id IN (SELECT value FROM json_each(?)) ORDER BY t.name_key`,
  planting: `SELECT x.planting_id AS id, t.name AS name FROM planting_tags x JOIN tags t ON t.id = x.tag_id
         WHERE x.planting_id IN (SELECT value FROM json_each(?)) ORDER BY t.name_key`,
};

/**
 * Normalise tag names, create any that do not exist, and return their ids in order. Invalid
 * names and too many tags are field errors (spec sections 5.6 and 19).
 */
export function resolveTagIds(ctx: Ctx, kind: TagKind, names: readonly string[]): string[] {
  const { tags, errors } = normalizeTags(names);
  const [first] = errors;
  if (first) throw validationFailed(first.message, { [`tags.${first.index}`]: first.message });
  if (tags.length > LIMITS.tagsPerRecord) {
    const message = `A ${KIND_WORD[kind]} can have up to 30 tags.`;
    throw validationFailed(message, { tags: message });
  }
  const find = ctx.sqlite.prepare('SELECT id FROM tags WHERE name_key = ?');
  const insert = ctx.sqlite.prepare(
    'INSERT INTO tags (id, name, name_key, pinned, created_at) VALUES (?, ?, ?, 0, ?)',
  );
  return tags.map((tag) => {
    const existing = find.get(tag.key) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = ctx.newId();
    insert.run(id, tag.name, tag.key, ctx.clock.now());
    return id;
  });
}

/** Replace the tags of one record. */
export function setTagIds(
  ctx: Ctx,
  kind: TagKind,
  recordId: string,
  tagIds: readonly string[],
): void {
  ctx.sqlite.prepare(REMOVE[kind]).run(recordId);
  const add = ctx.sqlite.prepare(ADD[kind]);
  for (const tagId of tagIds) add.run(recordId, tagId);
}

/** Tag display names for a batch of records, alphabetical, keyed by record id. */
export function tagNames(ctx: Ctx, kind: TagKind, ids: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const rows = ctx.sqlite.prepare(NAMES[kind]).all(JSON.stringify(ids)) as {
    id: string;
    name: string;
  }[];
  for (const row of rows) out.get(row.id)?.push(row.name);
  return out;
}

const LIST_SQL = `
  SELECT t.id, t.name, t.pinned,
    (SELECT count(*) FROM note_tags x JOIN notes n ON n.id = x.note_id
       WHERE x.tag_id = t.id AND n.deleted_at IS NULL) AS notes,
    (SELECT count(*) FROM person_tags x JOIN people p ON p.id = x.person_id
       WHERE x.tag_id = t.id AND p.deleted_at IS NULL) AS people,
    (SELECT count(*) FROM planting_tags x JOIN plantings p ON p.id = x.planting_id
       WHERE x.tag_id = t.id AND p.deleted_at IS NULL) AS plantings
  FROM tags t WHERE (? IS NULL OR t.id = ?)
  ORDER BY t.pinned DESC, t.name_key`;

interface TagListRow {
  id: string;
  name: string;
  pinned: number;
  notes: number;
  people: number;
  plantings: number;
}

const toTag = (r: TagListRow): Tag => ({
  id: r.id,
  name: r.name,
  pinned: r.pinned === 1,
  counts: { notes: r.notes, people: r.people, plantings: r.plantings },
});

/** All tags with usage counts, pinned first then by name. Soft-deleted records are not counted. */
export function listTags(ctx: Ctx): Tag[] {
  return (ctx.sqlite.prepare(LIST_SQL).all(null, null) as TagListRow[]).map(toTag);
}

export function getTag(ctx: Ctx, id: string): Tag {
  const row = ctx.sqlite.prepare(LIST_SQL).get(id, id) as TagListRow | undefined;
  if (!row) throw notFound('That tag is not here.');
  return toTag(row);
}

function assertExists(ctx: Ctx, id: string): void {
  if (!ctx.sqlite.prepare('SELECT 1 FROM tags WHERE id = ?').get(id)) {
    throw notFound('That tag is not here.');
  }
}

/** Create a tag, or return the existing one when the key matches. */
export function createTag(ctx: Ctx, name: string): Tag {
  const result = normalizeTag(name);
  if (!result.ok) throw validationFailed(result.message, { name: result.message });
  return inTx(ctx, () => {
    const existing = ctx.sqlite
      .prepare('SELECT id FROM tags WHERE name_key = ?')
      .get(result.key) as { id: string } | undefined;
    if (existing) return getTag(ctx, existing.id);
    const id = ctx.newId();
    ctx.sqlite
      .prepare('INSERT INTO tags (id, name, name_key, pinned, created_at) VALUES (?, ?, ?, 0, ?)')
      .run(id, result.name, result.key, ctx.clock.now());
    return getTag(ctx, id);
  });
}

/**
 * Rename and/or pin. A new name that matches another tag is a 409 with `existingId`, and the
 * client then confirms a merge. Changing only the casing of the same tag is allowed.
 */
export function updateTag(
  ctx: Ctx,
  id: string,
  patch: { name?: string | undefined; pinned?: boolean | undefined },
): Tag {
  return inTx(ctx, () => {
    assertExists(ctx, id);
    if (patch.name !== undefined) {
      const result = normalizeTag(patch.name);
      if (!result.ok) throw validationFailed(result.message, { name: result.message });
      const clash = ctx.sqlite
        .prepare('SELECT id, name FROM tags WHERE name_key = ? AND id <> ?')
        .get(result.key, id) as { id: string; name: string } | undefined;
      if (clash) {
        throw new AppError('conflict', `Merge into #${clash.name}?`, {
          details: { existingId: clash.id, existingName: clash.name },
        });
      }
      ctx.sqlite
        .prepare('UPDATE tags SET name = ?, name_key = ? WHERE id = ?')
        .run(result.name, result.key, id);
    }
    if (patch.pinned !== undefined) {
      ctx.sqlite.prepare('UPDATE tags SET pinned = ? WHERE id = ?').run(patch.pinned ? 1 : 0, id);
    }
    reindexTagged(ctx, id);
    return getTag(ctx, id);
  });
}

const MERGE: readonly string[] = [
  'INSERT OR IGNORE INTO note_tags (note_id, tag_id) SELECT note_id, ? FROM note_tags WHERE tag_id = ?',
  'INSERT OR IGNORE INTO person_tags (person_id, tag_id) SELECT person_id, ? FROM person_tags WHERE tag_id = ?',
  'INSERT OR IGNORE INTO planting_tags (planting_id, tag_id) SELECT planting_id, ? FROM planting_tags WHERE tag_id = ?',
];

/** Move every association from `id` to `intoId` (no duplicates), then delete `id`. */
export function mergeTag(ctx: Ctx, id: string, intoId: string): Tag {
  if (id === intoId) {
    throw validationFailed('Choose a different tag.', { intoId: 'Choose a different tag.' });
  }
  return inTx(ctx, () => {
    assertExists(ctx, id);
    assertExists(ctx, intoId);
    for (const statement of MERGE) ctx.sqlite.prepare(statement).run(intoId, id);
    // The join rows of the removed tag cascade away; every record now carries `intoId`.
    ctx.sqlite.prepare('DELETE FROM tags WHERE id = ?').run(id);
    reindexTagged(ctx, intoId);
    return getTag(ctx, intoId);
  });
}

const CARRIED = `
  SELECT 'note' AS kind, note_id AS id FROM note_tags WHERE tag_id = ?
  UNION ALL SELECT 'person', person_id FROM person_tags WHERE tag_id = ?
  UNION ALL SELECT 'planting', planting_id FROM planting_tags WHERE tag_id = ?`;

/** Delete a tag. Its join rows go with it; no note, person or farm entry is deleted. */
export function deleteTag(ctx: Ctx, id: string): void {
  inTx(ctx, () => {
    assertExists(ctx, id);
    const carried = ctx.sqlite.prepare(CARRIED).all(id, id, id) as { kind: TagKind; id: string }[];
    ctx.sqlite.prepare('DELETE FROM tags WHERE id = ?').run(id);
    for (const record of carried) reindex(ctx, record.kind, record.id);
  });
}
