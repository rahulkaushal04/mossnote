import { sql, type SQL } from 'drizzle-orm';
import type { GameDateQuery } from '@shared/gameDate';
import { allowedEdits, boundedDistance } from '@shared/editDistance';
import { parseSearch, hasCriteria, type ParsedSearch, type SearchTerm } from '@shared/searchQuery';
import { firstChars, fold } from '@shared/text';
import { normalizeTag } from '@shared/tags';
import type { SearchHit, SearchResponse } from '@shared/types';
import { BM25_WEIGHTS } from '../db/fts';
import type { Ctx } from './ctx';
import { searchMaps } from './maps';
import { readCalendar } from './search-index';

export type SearchKind = 'note' | 'person' | 'planting' | 'tag' | 'map';

/** Quote a term for FTS5 so user input can never act as an operator. */
export function quote(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

const MAX_FUZZY_CANDIDATES = 5;

/**
 * The alternatives a term expands to. A term of 4 or more characters that is not in the
 * vocabulary (as a prefix, for the last word) is replaced by the closest vocabulary terms within
 * the allowed edit distance, keeping the typed form too in case the vocabulary is slightly stale.
 */
export function expandTerm(
  term: string,
  isLast: boolean,
  vocab: ReadonlyMap<string, number>,
): string[] {
  const typed = fold(term);
  if (typed.length < 4) return [typed];
  let known = vocab.has(typed);
  if (!known && isLast) {
    for (const word of vocab.keys()) {
      if (word.startsWith(typed)) {
        known = true;
        break;
      }
    }
  }
  if (known) return [typed];
  const max = allowedEdits(typed);
  const candidates: [string, number][] = [];
  for (const [word, docs] of vocab) {
    if (Math.abs(word.length - typed.length) > max) continue;
    if (boundedDistance(typed, word, max) <= max) candidates.push([word, docs]);
  }
  candidates.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return [typed, ...candidates.slice(0, MAX_FUZZY_CANDIDATES).map(([word]) => word)];
}

/** The FTS5 MATCH expression for the positive terms, or null when there are none. */
export function buildMatch(
  terms: readonly SearchTerm[],
  vocab: ReadonlyMap<string, number>,
  mode: 'all' | 'any' = 'all',
): string | null {
  const parts: string[] = [];
  terms.forEach((term, index) => {
    if (term.phrase) {
      parts.push(quote(term.text));
      return;
    }
    const folded = fold(term.text);
    if (folded.trim() === '') return;
    const isLast = index === terms.length - 1;
    const [typed, ...near] = expandTerm(term.text, isLast, vocab);
    const first = isLast ? `${quote(typed ?? folded)}*` : quote(typed ?? folded);
    parts.push(near.length === 0 ? first : `(${[first, ...near.map(quote)].join(' OR ')})`);
  });
  if (parts.length === 0) return null;
  // Explicit AND: FTS5 rejects an implicit AND after a parenthesised group.
  return parts.join(mode === 'all' ? ' AND ' : ' OR ');
}

function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface Filters {
  /** Conditions on the record table aliased as `r`. */
  conditions: SQL[];
}

function tagCondition(kind: 'note' | 'person' | 'planting', names: readonly string[]): SQL[] {
  const table = { note: 'note_tags', person: 'person_tags', planting: 'planting_tags' }[kind];
  const column = { note: 'note_id', person: 'person_id', planting: 'planting_id' }[kind];
  return names.map((name) => {
    const tag = normalizeTag(name);
    if (!tag.ok) return sql`0`;
    return sql`EXISTS (SELECT 1 FROM ${sql.raw(table)} x JOIN tags t ON t.id = x.tag_id
                        WHERE x.${sql.raw(column)} = r.id AND t.name_key = ${tag.key})`;
  });
}

function dateCondition(column: SQL, date: GameDateQuery): SQL {
  const parts: SQL[] = [];
  if (date.year !== undefined) parts.push(sql`(${column} / 10000) = ${date.year}`);
  if (date.season !== undefined) parts.push(sql`((${column} % 10000) / 100) = ${date.season}`);
  if (date.day !== undefined) parts.push(sql`(${column} % 100) = ${date.day}`);
  return sql`(${column} IS NOT NULL AND ${sql.join(parts, sql` AND `)})`;
}

function noteFilters(p: ParsedSearch): Filters {
  const conditions: SQL[] = [sql`r.deleted_at IS NULL`, ...tagCondition('note', p.tags)];
  if (p.flags.discovery) conditions.push(sql`r.is_discovery = 1`);
  if (p.flags.question) conditions.push(sql`r.question_state IS NOT NULL`);
  if (p.flags.open) conditions.push(sql`r.question_state = 'open'`);
  if (p.flags.solved) conditions.push(sql`r.question_state = 'solved'`);
  for (const name of p.people) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM links l JOIN people pe ON pe.id = l.target_person_id
                   WHERE l.source_note_id = r.id AND pe.deleted_at IS NULL
                     AND pe.name LIKE ${`${likeEscape(name)}%`} ESCAPE '\\')`,
    );
  }
  if (p.date) conditions.push(dateCondition(sql`r.game_date`, p.date));
  return { conditions };
}

function personFilters(p: ParsedSearch): Filters {
  return { conditions: [sql`r.deleted_at IS NULL`, ...tagCondition('person', p.tags)] };
}

function plantingFilters(p: ParsedSearch): Filters {
  const conditions: SQL[] = [sql`r.deleted_at IS NULL`, ...tagCondition('planting', p.tags)];
  if (p.date) {
    conditions.push(
      sql`(${dateCondition(sql`r.planted_on`, p.date)} OR ${dateCondition(sql`r.harvested_on`, p.date)})`,
    );
  }
  return { conditions };
}

const TABLES = { note: 'notes', person: 'people', planting: 'plantings' } as const;

interface HitRow {
  id: string;
  title: string | null;
  body: string;
  game_date: number | null;
  ht: string | null;
  snip: string | null;
}

/** Which kinds can possibly match, given the structured filters in the query. */
function eligibleKinds(p: ParsedSearch, requested: readonly SearchKind[]): SearchKind[] {
  const flagged = Object.values(p.flags).some(Boolean);
  const kinds = new Set<SearchKind>(requested);
  if (p.kinds) {
    const allowed = new Set<SearchKind>(
      p.kinds.map((k) => (k === 'notes' ? 'note' : k === 'people' ? 'person' : 'planting')),
    );
    for (const kind of [...kinds]) if (!allowed.has(kind)) kinds.delete(kind);
  }
  if (flagged || p.people.length > 0) {
    kinds.delete('person');
    kinds.delete('planting');
  }
  if (p.date) kinds.delete('person');
  if (flagged || p.people.length > 0 || p.date || p.tags.length > 0 || p.kinds) kinds.delete('tag');
  // Maps match on plain words only: any chip or structured filter excludes them.
  if (flagged || p.people.length > 0 || p.date || p.tags.length > 0 || p.kinds) kinds.delete('map');
  return [...kinds];
}

function runKind(
  ctx: Ctx,
  kind: 'note' | 'person' | 'planting',
  p: ParsedSearch,
  match: string | null,
  excludeMatch: string | null,
  limit: number,
): SearchHit[] {
  const { conditions } = { note: noteFilters, person: personFilters, planting: plantingFilters }[
    kind
  ](p);
  if (excludeMatch) {
    conditions.push(
      sql`r.id NOT IN (SELECT ref_id FROM search_fts WHERE search_fts MATCH ${excludeMatch} AND kind = ${kind})`,
    );
  }
  const table = sql.raw(TABLES[kind]);
  const where = sql.join(conditions, sql` AND `);
  const titleCol = sql.raw(kind === 'note' ? 'r.title' : kind === 'person' ? 'r.name' : 'r.label');
  const bodyCol = sql.raw(kind === 'note' ? 'r.body' : 'r.notes');
  const dateCol = sql.raw(
    kind === 'note' ? 'r.game_date' : kind === 'planting' ? 'r.planted_on' : 'NULL',
  );
  const weights = sql.raw(BM25_WEIGHTS.join(', '));

  const rows = match
    ? ctx.db.all<HitRow>(
        sql`SELECT r.id AS id, ${titleCol} AS title, ${bodyCol} AS body, ${dateCol} AS game_date,
              highlight(search_fts, 2, char(1), char(2)) AS ht,
              snippet(search_fts, 3, char(1), char(2), '…', 14) AS snip
            FROM search_fts JOIN ${table} r ON r.id = search_fts.ref_id
            WHERE search_fts MATCH ${match} AND search_fts.kind = ${kind} AND ${where}
            ORDER BY bm25(search_fts, ${weights}), r.updated_at DESC, r.id
            LIMIT ${limit}`,
      )
    : ctx.db.all<HitRow>(
        sql`SELECT r.id AS id, ${titleCol} AS title, ${bodyCol} AS body, ${dateCol} AS game_date,
              NULL AS ht, NULL AS snip
            FROM ${table} r WHERE ${where} ORDER BY r.updated_at DESC, r.id LIMIT ${limit}`,
      );

  return rows.map((r) => {
    const plainTitle = (r.title ?? '').trim();
    const title = r.ht && plainTitle !== '' ? r.ht : plainTitle || firstChars(r.body);
    const snippet =
      r.snip && r.snip.trim() !== '' ? r.snip : match ? null : firstChars(r.body, 120) || null;
    return { kind, id: r.id, title, snippet, gameDate: r.game_date };
  });
}

function tagHits(ctx: Ctx, p: ParsedSearch, limit: number): SearchHit[] {
  const words = p.terms.filter((t) => !t.phrase).map((t) => fold(t.text));
  if (words.length === 0) return [];
  const conditions = words.map((w) => sql`t.name_key LIKE ${`%${likeEscape(w)}%`} ESCAPE '\\'`);
  const first = likeEscape(words[0] ?? '');
  const rows = ctx.db.all<{ id: string; name: string }>(
    sql`SELECT t.id AS id, t.name AS name FROM tags t WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY (t.name_key LIKE ${`${first}%`} ESCAPE '\\') DESC, t.pinned DESC, t.name_key LIMIT ${limit}`,
  );
  return rows.map((r) => ({ kind: 'tag', id: r.id, title: r.name, snippet: null, gameDate: null }));
}

const emptyGroups = (): SearchResponse['groups'] => ({
  notes: [],
  people: [],
  plantings: [],
  tags: [],
  maps: [],
});

export interface SearchParams {
  q: string;
  kinds?: readonly SearchKind[] | undefined;
  limit?: number | undefined;
}

/**
 * Full search: parse, build a quoted FTS5 expression with typo tolerance,
 * apply structured filters, rank with bm25 (title 10, body 1, tags 4, extra 2), group by kind.
 */
export function search(ctx: Ctx, params: SearchParams): SearchResponse {
  const limit = params.limit ?? 20;
  const parsed = parseSearch(params.q, readCalendar(ctx));
  const groups = emptyGroups();
  if (!hasCriteria(parsed)) return { groups, partial: false };

  const vocab = ctx.vocab.get(ctx.sqlite);
  const requested = params.kinds ?? (['note', 'person', 'planting', 'tag', 'map'] as const);
  const kinds = eligibleKinds(parsed, requested);
  const exclude = buildMatch(parsed.excluded, vocab);

  const run = (mode: 'all' | 'any'): SearchResponse['groups'] => {
    const found = emptyGroups();
    const match = buildMatch(parsed.terms, vocab, mode);
    if (kinds.includes('note')) found.notes = runKind(ctx, 'note', parsed, match, exclude, limit);
    if (kinds.includes('person'))
      found.people = runKind(ctx, 'person', parsed, match, exclude, limit);
    if (kinds.includes('planting'))
      found.plantings = runKind(ctx, 'planting', parsed, match, exclude, limit);
    if (kinds.includes('tag')) found.tags = tagHits(ctx, parsed, limit);
    if (kinds.includes('map')) {
      found.maps = searchMaps(ctx, parsed.terms.map((t) => t.text).join(' '), limit);
    }
    return found;
  };
  const count = (g: SearchResponse['groups']) =>
    g.notes.length + g.people.length + g.plantings.length + g.tags.length + g.maps.length;

  const all = run('all');
  if (count(all) > 0 || parsed.terms.length < 2) return { groups: all, partial: false };
  // Nothing matched every word: retry once with any word, ranked lower, labelled "Partial matches".
  const any = run('any');
  return { groups: any, partial: count(any) > 0 };
}
