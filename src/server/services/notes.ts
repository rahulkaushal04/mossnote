import { sql, type SQL } from 'drizzle-orm';
import { isValid } from '@shared/gameDate';
import type { Page, Note, NoteDetail, LinkType, NoteQuestion } from '@shared/types';
import type {
  NoteCreate,
  NoteFilter,
  NoteListQuery,
  NotePatch,
  QuestionInput,
} from '@shared/schemas/note';
import { normalizeTag } from '@shared/tags';
import { conflict, notFound, validationFailed } from '../errors';
import {
  decodeCursor,
  encodeCursor,
  first,
  inTx,
  iso,
  offsetFromCursor,
  pageOf,
  type Ctx,
} from './ctx';
import { linkedFromRefs, linksFor, setLinks } from './links';
import { readCalendar, reindex, unindex } from './search-index';
import { resolveTagIds, setTagIds, tagNames } from './tags';

export interface NoteRow {
  id: string;
  title: string | null;
  body: string;
  game_date: number | null;
  is_discovery: number;
  question_state: 'open' | 'solved' | null;
  resolution: string | null;
  solved_game_date: number | null;
  solved_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const OUTSIDE_CALENDAR = "That date isn't in your calendar.";
const NEEDS_CONTENT = 'Write something first.';

function toQuestion(row: NoteRow): NoteQuestion | null {
  if (!row.question_state) return null;
  return {
    state: row.question_state,
    resolution: row.resolution,
    solvedGameDate: row.solved_game_date,
    solvedAt: row.solved_at === null ? null : iso(row.solved_at),
  };
}

/** Build API notes (tags and live link chips included) for a batch of rows. */
export function toNotes(ctx: Ctx, rows: readonly NoteRow[]): Note[] {
  const ids = rows.map((r) => r.id);
  const tags = tagNames(ctx, 'note', ids);
  const links = linksFor(ctx, ids);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    gameDate: row.game_date,
    isDiscovery: row.is_discovery === 1,
    question: toQuestion(row),
    tags: tags.get(row.id) ?? [],
    links: links.get(row.id) ?? [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));
}

function loadRow(ctx: Ctx, id: string, includeDeleted = false): NoteRow {
  const row = ctx.sqlite.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
  if (!row || (!includeDeleted && row.deleted_at !== null))
    throw notFound('That note is not here.');
  return row;
}

export function getNote(ctx: Ctx, id: string): NoteDetail {
  const row = loadRow(ctx, id);
  const [note] = toNotes(ctx, [row]);
  if (!note) throw notFound('That note is not here.');
  return { ...note, linkedFrom: linkedFromRefs(ctx, 'note', id) };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

function filterConditions(f: NoteFilter): SQL[] {
  const conds: SQL[] = [sql`n.deleted_at IS NULL`];
  if (f.flag === 'discovery') conds.push(sql`n.is_discovery = 1`);
  if (f.flag === 'question') conds.push(sql`n.question_state IS NOT NULL`);
  if (f.state) conds.push(sql`n.question_state = ${f.state}`);
  for (const name of f.tag) {
    const tag = normalizeTag(name);
    conds.push(
      tag.ok
        ? sql`EXISTS (SELECT 1 FROM note_tags x JOIN tags t ON t.id = x.tag_id
                       WHERE x.note_id = n.id AND t.name_key = ${tag.key})`
        : sql`0`,
    );
  }
  if (f.person) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM links l WHERE l.source_note_id = n.id AND l.target_person_id = ${f.person})`,
    );
  }
  if (f.planting) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM links l WHERE l.source_note_id = n.id AND l.target_planting_id = ${f.planting})`,
    );
  }
  if (f.gameDate !== undefined) conds.push(sql`n.game_date = ${f.gameDate}`);
  if (f.from !== undefined) conds.push(sql`n.game_date >= ${f.from}`);
  if (f.to !== undefined) conds.push(sql`n.game_date <= ${f.to}`);
  if (f.undated) conds.push(sql`n.game_date IS NULL`);
  if (f.createdFrom !== undefined) conds.push(sql`n.created_at >= ${f.createdFrom}`);
  if (f.createdTo !== undefined) conds.push(sql`n.created_at <= ${f.createdTo}`);
  return conds;
}

interface NoteCursor {
  g: number | null;
  c: number;
  i: string;
}
const isNoteCursor = (v: unknown): v is NoteCursor => {
  const c = v as Partial<NoteCursor> | null;
  return (
    typeof c === 'object' &&
    c !== null &&
    (c.g === null || Number.isInteger(c.g)) &&
    Number.isInteger(c.c) &&
    typeof c.i === 'string'
  );
};

/** The rows after a cursor, in the sort order with undated notes last in both directions. */
function afterCursor(cursor: NoteCursor, order: 'asc' | 'desc'): SQL {
  const op = order === 'desc' ? sql.raw('<') : sql.raw('>');
  const tail = sql`(n.created_at ${op} ${cursor.c} OR (n.created_at = ${cursor.c} AND n.id ${op} ${cursor.i}))`;
  if (cursor.g === null) return sql`(n.game_date IS NULL AND ${tail})`;
  return sql`(n.game_date IS NULL OR n.game_date ${op} ${cursor.g}
              OR (n.game_date = ${cursor.g} AND ${tail}))`;
}

/**
 * Notes sorted by game date, then creation time, then id, undated last in both directions, with
 * keyset pagination.
 */
export function listNotes(ctx: Ctx, query: NoteListQuery): Page<Note> {
  const conds = filterConditions(query);
  if (query.cursor) {
    conds.push(afterCursor(decodeCursor(query.cursor, isNoteCursor), query.order));
  }
  const dir = sql.raw(query.order === 'desc' ? 'DESC' : 'ASC');
  const rows = ctx.db.all<NoteRow>(
    sql`SELECT n.* FROM notes n WHERE ${sql.join(conds, sql` AND `)}
        ORDER BY (n.game_date IS NULL) ASC, n.game_date ${dir}, n.created_at ${dir}, n.id ${dir}
        LIMIT ${query.limit + 1}`,
  );
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor({ g: last.game_date, c: last.created_at, i: last.id })
      : null;
  return { items: toNotes(ctx, page), nextCursor };
}

export function countNotes(ctx: Ctx, filter: NoteFilter): number {
  const row = ctx.db.get<{ n: number }>(
    sql`SELECT count(*) AS n FROM notes n WHERE ${sql.join(filterConditions(filter), sql` AND `)}`,
  );
  return row.n;
}

/** Notes that link to a person or farm entry, newest first (`GET /api/people/:id/notes`). */
export function listBacklinks(
  ctx: Ctx,
  type: Exclude<LinkType, 'note'>,
  id: string,
  options: { limit: number; cursor?: string | undefined },
): Page<Note> {
  const offset = offsetFromCursor(options.cursor);
  const column = sql.raw(type === 'person' ? 'target_person_id' : 'target_planting_id');
  const rows = ctx.db.all<NoteRow>(
    sql`SELECT n.* FROM notes n
        WHERE n.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM links l WHERE l.source_note_id = n.id AND l.${column} = ${id})
        ORDER BY n.created_at DESC, n.id DESC LIMIT ${options.limit + 1} OFFSET ${offset}`,
  );
  const { items, nextCursor } = pageOf(rows, options.limit, offset);
  return { items: toNotes(ctx, items), nextCursor };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function currentGameDate(ctx: Ctx): number | null {
  const row = ctx.sqlite
    .prepare("SELECT value FROM settings WHERE key = 'currentGameDate'")
    .get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as number | null) : null;
}

function checkDate(ctx: Ctx, value: number | null | undefined, field: string): void {
  if (value === null || value === undefined) return;
  if (!isValid(value, readCalendar(ctx))) {
    throw validationFailed(OUTSIDE_CALENDAR, { [field]: OUTSIDE_CALENDAR });
  }
}

interface QuestionColumns {
  question_state: 'open' | 'solved' | null;
  resolution: string | null;
  solved_game_date: number | null;
  solved_at: number | null;
}

/**
 * Resolve the question columns for a create or patch: reopening keeps the
 * resolution text, solving records the solved date (default: the current date) and time, and
 * `null` removes the question entirely.
 */
function questionColumns(
  ctx: Ctx,
  previous: NoteRow | null,
  input: QuestionInput | null | undefined,
): QuestionColumns {
  if (input === undefined) {
    return {
      question_state: previous?.question_state ?? null,
      resolution: previous?.resolution ?? null,
      solved_game_date: previous?.solved_game_date ?? null,
      solved_at: previous?.solved_at ?? null,
    };
  }
  if (input === null) {
    return { question_state: null, resolution: null, solved_game_date: null, solved_at: null };
  }
  const resolution =
    input.resolution === undefined ? (previous?.resolution ?? null) : input.resolution;
  if (input.state === 'open') {
    return { question_state: 'open', resolution, solved_game_date: null, solved_at: null };
  }
  const wasSolved = previous?.question_state === 'solved';
  const solvedGameDate =
    input.solvedGameDate !== undefined
      ? input.solvedGameDate
      : wasSolved
        ? previous.solved_game_date
        : currentGameDate(ctx);
  checkDate(ctx, solvedGameDate, 'question.solvedGameDate');
  return {
    question_state: 'solved',
    resolution,
    solved_game_date: solvedGameDate,
    solved_at: wasSolved && previous.solved_at !== null ? previous.solved_at : ctx.clock.now(),
  };
}

function assertContent(title: string | null, body: string): void {
  if ((title ?? '').trim() === '' && body.trim() === '') {
    throw validationFailed(NEEDS_CONTENT, { body: NEEDS_CONTENT });
  }
}

export interface CreateResult {
  note: Note;
  /** False when the id already existed and the existing note is returned (idempotent retry). */
  created: boolean;
}

/**
 * Create a note. The client generates the id, so a retry after a network failure returns the
 * existing note instead of making a duplicate.
 */
export function createNote(ctx: Ctx, input: NoteCreate): CreateResult {
  return inTx(ctx, () => {
    if (input.id) {
      const existing = ctx.sqlite.prepare('SELECT * FROM notes WHERE id = ?').get(input.id) as
        NoteRow | undefined;
      if (existing) return { note: first(toNotes(ctx, [existing])), created: false };
    }
    const title = input.title ?? null;
    const body = input.body ?? '';
    assertContent(title, body);
    checkDate(ctx, input.gameDate, 'gameDate');
    const question = questionColumns(ctx, null, input.question);
    const tagIds = resolveTagIds(ctx, 'note', input.tags ?? []);

    const id = input.id ?? ctx.newId();
    const now = ctx.clock.now();
    ctx.sqlite
      .prepare(
        `INSERT INTO notes (id, title, body, game_date, is_discovery, question_state, resolution,
           solved_game_date, solved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        title,
        body,
        input.gameDate ?? null,
        input.isDiscovery ? 1 : 0,
        question.question_state,
        question.resolution,
        question.solved_game_date,
        question.solved_at,
        now,
        now,
      );
    setTagIds(ctx, 'note', id, tagIds);
    setLinks(ctx, id, input.links ?? []);
    reindex(ctx, 'note', id);
    return { note: first(toNotes(ctx, [loadRow(ctx, id)])), created: true };
  });
}

/**
 * Partial update: an absent field is unchanged, `null` clears a nullable one,
 * and `tags` and `links` replace the whole set. `expectedUpdatedAt` guards against a stale edit.
 */
export function patchNote(ctx: Ctx, id: string, patch: NotePatch): Note {
  return inTx(ctx, () => {
    const row = loadRow(ctx, id);
    if (
      patch.expectedUpdatedAt !== undefined &&
      Date.parse(patch.expectedUpdatedAt) !== row.updated_at
    ) {
      throw conflict('This note changed in another window.', {
        current: toNotes(ctx, [row])[0],
      });
    }
    const title = patch.title === undefined ? row.title : patch.title;
    const body = patch.body ?? row.body;
    assertContent(title, body);
    const gameDate = patch.gameDate === undefined ? row.game_date : patch.gameDate;
    checkDate(ctx, gameDate, 'gameDate');
    const question = questionColumns(ctx, row, patch.question);
    const tagIds = patch.tags === undefined ? null : resolveTagIds(ctx, 'note', patch.tags);

    // updatedAt always advances, so two saves in the same millisecond still conflict correctly.
    const updatedAt = Math.max(ctx.clock.now(), row.updated_at + 1);
    ctx.sqlite
      .prepare(
        `UPDATE notes SET title = ?, body = ?, game_date = ?, is_discovery = ?, question_state = ?,
           resolution = ?, solved_game_date = ?, solved_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        title,
        body,
        gameDate,
        patch.isDiscovery === undefined ? row.is_discovery : patch.isDiscovery ? 1 : 0,
        question.question_state,
        question.resolution,
        question.solved_game_date,
        question.solved_at,
        updatedAt,
        id,
      );
    if (tagIds) setTagIds(ctx, 'note', id, tagIds);
    if (patch.links) setLinks(ctx, id, patch.links);
    reindex(ctx, 'note', id);
    return first(toNotes(ctx, [loadRow(ctx, id)]));
  });
}

/** Soft delete. Deleting an already deleted note is a no-op. */
export function deleteNote(ctx: Ctx, id: string): void {
  inTx(ctx, () => {
    const row = loadRow(ctx, id, true);
    if (row.deleted_at !== null) return;
    ctx.sqlite.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(ctx.clock.now(), id);
    unindex(ctx, 'note', id);
  });
}

/** Undo a delete. Tags and links were never removed, so they come back with the note. */
export function restoreNote(ctx: Ctx, id: string): Note {
  return inTx(ctx, () => {
    const row = loadRow(ctx, id, true);
    if (row.deleted_at !== null) {
      ctx.sqlite.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ?').run(id);
      reindex(ctx, 'note', id);
    }
    return first(toNotes(ctx, [loadRow(ctx, id)]));
  });
}
