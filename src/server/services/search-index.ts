import type { Calendar } from '@shared/constants';
import { decode } from '@shared/gameDate';
import { DEFAULT_CALENDAR } from '@shared/constants';
import { calendarSchema } from '@shared/schemas/calendar';
import type { Ctx } from './ctx';

export type IndexKind = 'note' | 'person' | 'planting';

/** Game date as searchable words, for example `Spring 3 Year 1`. */
export function dateWords(key: number | null, calendar: Calendar): string {
  if (key === null) return '';
  const { year, season, day } = decode(key);
  const name = calendar.seasons[season]?.name;
  return name === undefined ? '' : `${name} ${day} Year ${year}`;
}

export function readCalendar(ctx: Ctx): Calendar {
  const row = ctx.sqlite.prepare("SELECT value FROM settings WHERE key = 'calendar'").get() as
    { value: string } | undefined;
  return row ? calendarSchema.parse(JSON.parse(row.value)) : DEFAULT_CALENDAR;
}

// One row per live record, with tag names and linked names gathered in SQL. The trailing
// `(? IS NULL OR id = ?)` lets the same statement reindex one record or all of them.
const NOTES_SQL = `
  SELECT n.id, n.title, n.body, n.game_date, n.solved_game_date, n.resolution,
    (SELECT group_concat(t.name, ' ') FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
       WHERE nt.note_id = n.id) AS tags,
    (SELECT group_concat(p.name, ' ') FROM links l JOIN people p ON p.id = l.target_person_id
       WHERE l.source_note_id = n.id AND p.deleted_at IS NULL) AS persons,
    (SELECT group_concat(pl.label, ' ') FROM links l JOIN plantings pl ON pl.id = l.target_planting_id
       WHERE l.source_note_id = n.id AND pl.deleted_at IS NULL) AS plantings
  FROM notes n WHERE n.deleted_at IS NULL AND (? IS NULL OR n.id = ?)`;

const PEOPLE_SQL = `
  SELECT p.id, p.name, p.notes, p.custom_fields,
    (SELECT group_concat(t.name, ' ') FROM person_tags pt JOIN tags t ON t.id = pt.tag_id
       WHERE pt.person_id = p.id) AS tags
  FROM people p WHERE p.deleted_at IS NULL AND (? IS NULL OR p.id = ?)`;

const PLANTINGS_SQL = `
  SELECT pl.id, pl.label, pl.notes, pl.custom_fields, pl.planted_on, pl.harvested_on,
    (SELECT group_concat(t.name, ' ') FROM planting_tags pt JOIN tags t ON t.id = pt.tag_id
       WHERE pt.planting_id = pl.id) AS tags
  FROM plantings pl WHERE pl.deleted_at IS NULL AND (? IS NULL OR pl.id = ?)`;

const INSERT_SQL =
  'INSERT INTO search_fts (kind, ref_id, title, body, tags, extra) VALUES (?, ?, ?, ?, ?, ?)';
const DELETE_SQL = 'DELETE FROM search_fts WHERE kind = ? AND ref_id = ?';

function fieldWords(json: string): string {
  try {
    const fields = JSON.parse(json) as { label: string; value: string }[];
    return fields.map((f) => `${f.label} ${f.value}`).join(' ');
  } catch {
    return '';
  }
}

const join = (...parts: (string | null | undefined)[]) => parts.filter((p) => p).join(' ');

interface NoteRow {
  id: string;
  title: string | null;
  body: string;
  game_date: number | null;
  solved_game_date: number | null;
  resolution: string | null;
  tags: string | null;
  persons: string | null;
  plantings: string | null;
}
interface PersonRow {
  id: string;
  name: string;
  notes: string;
  custom_fields: string;
  tags: string | null;
}
interface PlantingRow {
  id: string;
  label: string;
  notes: string;
  custom_fields: string;
  planted_on: number | null;
  harvested_on: number | null;
  tags: string | null;
}

/** Insert the index rows for one kind. `id` null means every live record of that kind. */
function insertRows(ctx: Ctx, kind: IndexKind, id: string | null, calendar: Calendar): number {
  const insert = ctx.sqlite.prepare(INSERT_SQL);
  let count = 0;
  if (kind === 'note') {
    for (const r of ctx.sqlite.prepare(NOTES_SQL).all(id, id) as NoteRow[]) {
      insert.run(
        'note',
        r.id,
        r.title ?? '',
        r.body,
        r.tags ?? '',
        join(
          r.resolution,
          r.persons,
          r.plantings,
          dateWords(r.game_date, calendar),
          dateWords(r.solved_game_date, calendar),
        ),
      );
      count++;
    }
  } else if (kind === 'person') {
    for (const r of ctx.sqlite.prepare(PEOPLE_SQL).all(id, id) as PersonRow[]) {
      insert.run('person', r.id, r.name, r.notes, r.tags ?? '', fieldWords(r.custom_fields));
      count++;
    }
  } else {
    for (const r of ctx.sqlite.prepare(PLANTINGS_SQL).all(id, id) as PlantingRow[]) {
      insert.run(
        'planting',
        r.id,
        r.label,
        r.notes,
        r.tags ?? '',
        join(
          fieldWords(r.custom_fields),
          dateWords(r.planted_on, calendar),
          dateWords(r.harvested_on, calendar),
        ),
      );
      count++;
    }
  }
  return count;
}

/**
 * Rebuild the index row for one record, in the caller's transaction. A deleted
 * or missing record simply loses its row.
 */
export function reindex(ctx: Ctx, kind: IndexKind, id: string): void {
  ctx.sqlite.prepare(DELETE_SQL).run(kind, id);
  insertRows(ctx, kind, id, readCalendar(ctx));
  ctx.vocab.noteWrites();
}

export function unindex(ctx: Ctx, kind: IndexKind, id: string): void {
  ctx.sqlite.prepare(DELETE_SQL).run(kind, id);
  ctx.vocab.noteWrites();
}

/** Rebuild the whole index from the tables (`npm run db:reindex`, import, calendar rename). */
export function reindexAll(ctx: Ctx): { notes: number; people: number; plantings: number } {
  const calendar = readCalendar(ctx);
  return ctx.db.transaction(() => {
    ctx.sqlite.prepare('DELETE FROM search_fts').run();
    const counts = {
      notes: insertRows(ctx, 'note', null, calendar),
      people: insertRows(ctx, 'person', null, calendar),
      plantings: insertRows(ctx, 'planting', null, calendar),
    };
    ctx.vocab.invalidate();
    return counts;
  });
}

const NOTES_LINKING = `
  SELECT source_note_id AS id FROM links
  WHERE target_person_id = ? OR target_planting_id = ? OR target_note_id = ?`;

/** Notes show linked names in the index, so renaming or deleting a target reindexes them. */
export function reindexLinkedNotes(ctx: Ctx, targetId: string): void {
  const ids = ctx.sqlite.prepare(NOTES_LINKING).all(targetId, targetId, targetId) as {
    id: string;
  }[];
  for (const { id } of ids) reindex(ctx, 'note', id);
}

const TAGGED = `
  SELECT 'note' AS kind, note_id AS id FROM note_tags WHERE tag_id = ?
  UNION ALL SELECT 'person', person_id FROM person_tags WHERE tag_id = ?
  UNION ALL SELECT 'planting', planting_id FROM planting_tags WHERE tag_id = ?`;

/** Reindex every record that carries a tag (rename, merge, delete). */
export function reindexTagged(ctx: Ctx, tagId: string): void {
  const rows = ctx.sqlite.prepare(TAGGED).all(tagId, tagId, tagId) as {
    kind: IndexKind;
    id: string;
  }[];
  for (const row of rows) reindex(ctx, row.kind, row.id);
}

/** Row count per kind, for the consistency tests and `db:reindex`. */
export function indexCounts(ctx: Ctx): Record<IndexKind, number> {
  const count = (kind: string) =>
    (
      ctx.sqlite.prepare('SELECT count(*) AS n FROM search_fts WHERE kind = ?').get(kind) as {
        n: number;
      }
    ).n;
  return { note: count('note'), person: count('person'), planting: count('planting') };
}
