import { isValid } from '@shared/gameDate';
import type { Page, Planting } from '@shared/types';
import type { PlantingCreate, PlantingListQuery, PlantingPatch } from '@shared/schemas/planting';
import { normalizeTag } from '@shared/tags';
import { notFound, validationFailed } from '../errors';
import { first, inTx, iso, offsetFromCursor, pageOf, type Ctx } from './ctx';
import { assertFresh, nextUpdatedAt, parseFields, serializeFields } from './records';
import { readCalendar, reindex, reindexLinkedNotes, unindex } from './search-index';
import { resolveTagIds, setTagIds, tagNames } from './tags';

interface PlantingRow {
  id: string;
  label: string;
  planted_on: number | null;
  harvested_on: number | null;
  planted_count: number | null;
  harvested_count: number | null;
  notes: string;
  custom_fields: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export function toPlantings(ctx: Ctx, rows: readonly PlantingRow[]): Planting[] {
  const tags = tagNames(
    ctx,
    'planting',
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    plantedOn: r.planted_on,
    harvestedOn: r.harvested_on,
    plantedCount: r.planted_count,
    harvestedCount: r.harvested_count,
    notes: r.notes,
    customFields: parseFields(r.custom_fields),
    tags: tags.get(r.id) ?? [],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }));
}

function loadRow(ctx: Ctx, id: string, includeDeleted = false): PlantingRow {
  const row = ctx.sqlite.prepare('SELECT * FROM plantings WHERE id = ?').get(id) as
    PlantingRow | undefined;
  if (!row || (!includeDeleted && row.deleted_at !== null))
    throw notFound('That entry is not here.');
  return row;
}

const one = (ctx: Ctx, id: string): Planting => first(toPlantings(ctx, [loadRow(ctx, id)]));

export const getPlanting = (ctx: Ctx, id: string): Planting => one(ctx, id);

// Growing: planted and not harvested. Done: harvested. Noted: neither date (spec section 10).
const LIST = `
  SELECT p.* FROM plantings p WHERE p.deleted_at IS NULL
    AND (? IS NULL OR (? = 'growing' AND p.planted_on IS NOT NULL AND p.harvested_on IS NULL)
                   OR (? = 'done' AND p.harvested_on IS NOT NULL)
                   OR (? = 'noted' AND p.planted_on IS NULL AND p.harvested_on IS NULL))
    AND (? IS NULL OR EXISTS (SELECT 1 FROM planting_tags x JOIN tags t ON t.id = x.tag_id
                               WHERE x.planting_id = p.id AND t.name_key = ?))
  ORDER BY (p.planted_on IS NULL), p.planted_on DESC, p.created_at DESC, p.id DESC
  LIMIT ? OFFSET ?`;

export function listPlantings(ctx: Ctx, query: PlantingListQuery): Page<Planting> {
  const offset = offsetFromCursor(query.cursor);
  const status = query.status ?? null;
  const tag = query.tag === undefined ? null : normalizeTag(query.tag);
  const key = tag === null ? null : tag.ok ? tag.key : '\u0000no-such-tag';
  const rows = ctx.sqlite
    .prepare(LIST)
    .all(status, status, status, status, key, key, query.limit + 1, offset) as PlantingRow[];
  const { items, nextCursor } = pageOf(rows, query.limit, offset);
  return { items: toPlantings(ctx, items), nextCursor };
}

const OUTSIDE = "That date isn't in your calendar.";
const BEFORE = "Harvest can't be before planting.";

function checkDates(ctx: Ctx, plantedOn: number | null, harvestedOn: number | null): void {
  const calendar = readCalendar(ctx);
  if (plantedOn !== null && !isValid(plantedOn, calendar)) {
    throw validationFailed(OUTSIDE, { plantedOn: OUTSIDE });
  }
  if (harvestedOn !== null && !isValid(harvestedOn, calendar)) {
    throw validationFailed(OUTSIDE, { harvestedOn: OUTSIDE });
  }
  if (plantedOn !== null && harvestedOn !== null && harvestedOn < plantedOn) {
    throw validationFailed(BEFORE, { harvestedOn: BEFORE });
  }
}

export function createPlanting(
  ctx: Ctx,
  input: PlantingCreate,
): { planting: Planting; created: boolean } {
  return inTx(ctx, () => {
    if (input.id) {
      const existing = ctx.sqlite.prepare('SELECT * FROM plantings WHERE id = ?').get(input.id) as
        PlantingRow | undefined;
      if (existing) return { planting: first(toPlantings(ctx, [existing])), created: false };
    }
    const plantedOn = input.plantedOn ?? null;
    const harvestedOn = input.harvestedOn ?? null;
    checkDates(ctx, plantedOn, harvestedOn);
    const tagIds = resolveTagIds(ctx, 'planting', input.tags ?? []);
    const id = input.id ?? ctx.newId();
    const now = ctx.clock.now();
    ctx.sqlite
      .prepare(
        `INSERT INTO plantings (id, label, planted_on, harvested_on, planted_count, harvested_count,
           notes, custom_fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.label,
        plantedOn,
        harvestedOn,
        input.plantedCount ?? null,
        input.harvestedCount ?? null,
        input.notes ?? '',
        serializeFields(input.customFields ?? []),
        now,
        now,
      );
    setTagIds(ctx, 'planting', id, tagIds);
    reindex(ctx, 'planting', id);
    return { planting: one(ctx, id), created: true };
  });
}

export function patchPlanting(ctx: Ctx, id: string, patch: PlantingPatch): Planting {
  return inTx(ctx, () => {
    const row = loadRow(ctx, id);
    assertFresh(patch.expectedUpdatedAt, row.updated_at, () => one(ctx, id), 'entry');
    const plantedOn = patch.plantedOn === undefined ? row.planted_on : patch.plantedOn;
    const harvestedOn = patch.harvestedOn === undefined ? row.harvested_on : patch.harvestedOn;
    checkDates(ctx, plantedOn, harvestedOn);
    const tagIds = patch.tags === undefined ? null : resolveTagIds(ctx, 'planting', patch.tags);
    const renamed = patch.label !== undefined && patch.label !== row.label;
    ctx.sqlite
      .prepare(
        `UPDATE plantings SET label = ?, planted_on = ?, harvested_on = ?, planted_count = ?,
           harvested_count = ?, notes = ?, custom_fields = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.label ?? row.label,
        plantedOn,
        harvestedOn,
        patch.plantedCount === undefined ? row.planted_count : patch.plantedCount,
        patch.harvestedCount === undefined ? row.harvested_count : patch.harvestedCount,
        patch.notes ?? row.notes,
        patch.customFields === undefined ? row.custom_fields : serializeFields(patch.customFields),
        nextUpdatedAt(ctx, row.updated_at),
        id,
      );
    if (tagIds) setTagIds(ctx, 'planting', id, tagIds);
    reindex(ctx, 'planting', id);
    if (renamed) reindexLinkedNotes(ctx, id);
    return one(ctx, id);
  });
}

export function deletePlanting(ctx: Ctx, id: string): void {
  inTx(ctx, () => {
    const row = loadRow(ctx, id, true);
    if (row.deleted_at !== null) return;
    ctx.sqlite.prepare('UPDATE plantings SET deleted_at = ? WHERE id = ?').run(ctx.clock.now(), id);
    unindex(ctx, 'planting', id);
    reindexLinkedNotes(ctx, id);
  });
}

export function restorePlanting(ctx: Ctx, id: string): Planting {
  return inTx(ctx, () => {
    const row = loadRow(ctx, id, true);
    if (row.deleted_at !== null) {
      ctx.sqlite.prepare('UPDATE plantings SET deleted_at = NULL WHERE id = ?').run(id);
      reindex(ctx, 'planting', id);
      reindexLinkedNotes(ctx, id);
    }
    return one(ctx, id);
  });
}

// One label per case-insensitive spelling, so "Spot" and "spot" are offered once.
const LABELS_PERSON = `
  SELECT min(json_extract(f.value, '$.label')) AS label
  FROM people p, json_each(p.custom_fields) f
  WHERE p.deleted_at IS NULL AND json_extract(f.value, '$.label') LIKE ? ESCAPE '\\'
  GROUP BY lower(json_extract(f.value, '$.label'))
  ORDER BY label COLLATE NOCASE LIMIT 20`;
const LABELS_PLANTING = `
  SELECT min(json_extract(f.value, '$.label')) AS label
  FROM plantings p, json_each(p.custom_fields) f
  WHERE p.deleted_at IS NULL AND json_extract(f.value, '$.label') LIKE ? ESCAPE '\\'
  GROUP BY lower(json_extract(f.value, '$.label'))
  ORDER BY label COLLATE NOCASE LIMIT 20`;

/** Custom field labels already used on other records, for autocomplete. */
export function fieldLabels(ctx: Ctx, kind: 'person' | 'planting', q: string): string[] {
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = ctx.sqlite
    .prepare(kind === 'person' ? LABELS_PERSON : LABELS_PLANTING)
    .all(`${escaped}%`) as { label: string }[];
  return rows.map((r) => r.label);
}
