import { sql } from 'drizzle-orm';
import { format } from '@shared/gameDate';
import { fold } from '@shared/text';
import type { PickItem } from '@shared/types';
import type { Ctx } from './ctx';
import { noteLabel } from './links';
import { readCalendar } from './search-index';
import { quote } from './search';

export interface PickParams {
  kind: 'tag' | 'person' | 'note' | 'planting' | 'any';
  q: string;
  limit: number;
  exclude: readonly string[];
}

function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const TAGS = `
  SELECT t.id, t.name,
    CASE WHEN t.name_key LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS grp,
    max(t.created_at, coalesce((SELECT max(n.updated_at) FROM note_tags x JOIN notes n ON n.id = x.note_id
                                WHERE x.tag_id = t.id AND n.deleted_at IS NULL), 0)) AS used
  FROM tags t
  WHERE (? = '' OR t.name_key LIKE ? ESCAPE '\\')
    AND t.id NOT IN (SELECT value FROM json_each(?))
  ORDER BY grp, used DESC, t.name_key LIMIT ?`;

const PEOPLE = `
  SELECT p.id, p.name,
    CASE WHEN p.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS grp,
    coalesce((SELECT max(l.created_at) FROM links l WHERE l.target_person_id = p.id), p.updated_at) AS used
  FROM people p
  WHERE p.deleted_at IS NULL AND (? = '' OR p.name LIKE ? ESCAPE '\\')
    AND p.id NOT IN (SELECT value FROM json_each(?))
  ORDER BY grp, used DESC, p.name COLLATE NOCASE LIMIT ?`;

const RECENT_NOTES = `
  SELECT n.id, n.title, n.body, n.game_date FROM notes n
  WHERE n.deleted_at IS NULL AND n.id NOT IN (SELECT value FROM json_each(?))
  ORDER BY n.updated_at DESC, n.id DESC LIMIT ?`;
const RECENT_PLANTINGS = `
  SELECT p.id, p.label FROM plantings p
  WHERE p.deleted_at IS NULL AND p.id NOT IN (SELECT value FROM json_each(?))
  ORDER BY p.updated_at DESC, p.id DESC LIMIT ?`;

/** Prefix query over title and the start of the body (column filter `{title body}`). */
function prefixMatch(q: string): string | null {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const terms = words.map((w, i) => (i === words.length - 1 ? `${quote(w)}*` : quote(w)));
  return `{title body} : (${terms.join(' ')})`;
}

function pickNotes(ctx: Ctx, p: PickParams): PickItem[] {
  const calendar = readCalendar(ctx);
  const exclude = JSON.stringify(p.exclude);
  const match = prefixMatch(p.q);
  const rows = match
    ? ctx.db.all<{ id: string; title: string | null; body: string; game_date: number | null }>(
        sql`SELECT n.id, n.title, n.body, n.game_date FROM search_fts
            JOIN notes n ON n.id = search_fts.ref_id
            WHERE search_fts MATCH ${match} AND search_fts.kind = 'note' AND n.deleted_at IS NULL
              AND n.id NOT IN (SELECT value FROM json_each(${exclude}))
            ORDER BY bm25(search_fts, 0, 0, 10, 1, 4, 2), n.updated_at DESC LIMIT ${p.limit}`,
      )
    : (ctx.sqlite.prepare(RECENT_NOTES).all(exclude, p.limit) as {
        id: string;
        title: string | null;
        body: string;
        game_date: number | null;
      }[]);
  return rows.map((r) => ({
    kind: 'note' as const,
    id: r.id,
    label: noteLabel(r.title, r.body),
    detail: r.game_date === null ? null : format(r.game_date, calendar, { withYear: true }),
  }));
}

function pickPlantings(ctx: Ctx, p: PickParams): PickItem[] {
  const exclude = JSON.stringify(p.exclude);
  const match = prefixMatch(p.q);
  const rows = match
    ? ctx.db.all<{ id: string; label: string }>(
        sql`SELECT r.id, r.label FROM search_fts JOIN plantings r ON r.id = search_fts.ref_id
            WHERE search_fts MATCH ${match} AND search_fts.kind = 'planting' AND r.deleted_at IS NULL
              AND r.id NOT IN (SELECT value FROM json_each(${exclude}))
            ORDER BY bm25(search_fts, 0, 0, 10, 1, 4, 2), r.updated_at DESC LIMIT ${p.limit}`,
      )
    : (ctx.sqlite.prepare(RECENT_PLANTINGS).all(exclude, p.limit) as {
        id: string;
        label: string;
      }[]);
  return rows.map((r) => ({ kind: 'planting' as const, id: r.id, label: r.label, detail: null }));
}

function pickNamed(ctx: Ctx, kind: 'tag' | 'person', p: PickParams): PickItem[] {
  const query = kind === 'tag' ? fold(p.q.replace(/^#+/, '')).replace(/\s+/g, '-') : p.q.trim();
  const escaped = likeEscape(query);
  const rows = ctx.sqlite
    .prepare(kind === 'tag' ? TAGS : PEOPLE)
    .all(`${escaped}%`, query, `%${escaped}%`, JSON.stringify(p.exclude), p.limit) as {
    id: string;
    name: string;
  }[];
  return rows.map((r) => ({ kind, id: r.id, label: r.name, detail: null }));
}

/**
 * Suggestions for the `#`, `@`, `[[` and `/link` pickers. Tags and people match
 * a prefix first, then a substring, ordered by recent use; notes and farm entries use FTS prefix
 * queries; an empty query returns the most recently updated items.
 */
export function pick(ctx: Ctx, p: PickParams): PickItem[] {
  if (p.kind === 'tag' || p.kind === 'person') return pickNamed(ctx, p.kind, p);
  if (p.kind === 'note') return pickNotes(ctx, p);
  if (p.kind === 'planting') return pickPlantings(ctx, p);
  // `any`: people, notes and farm entries, interleaved so every kind shows up.
  const lists = [pickNamed(ctx, 'person', p), pickNotes(ctx, p), pickPlantings(ctx, p)];
  const out: PickItem[] = [];
  for (let i = 0; out.length < p.limit && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const item = list[i];
      if (item && out.length < p.limit) out.push(item);
    }
  }
  return out;
}
