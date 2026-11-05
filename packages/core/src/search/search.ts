import { z } from 'zod';
import type { Db } from '../db/types.ts';
import { err, ok, type Result } from '../result.ts';
import type { Store } from '../store/store.ts';
import { tagKey } from '../tags/tags.ts';
import { parse, safe, trashedFolderIds } from '../trash/derive.ts';
import { searchParamsSchema, type SearchHit, type SearchPage, type SearchSort } from './params.ts';
import { parseQuery, toFtsExclude, toFtsMatch } from './query.ts';
import { MARK_CLOSE, MARK_OPEN, rangesFromMarked, stripMarkerChars } from './ranges.ts';
import type { IndexAdmin } from './rebuild.ts';

const DEFAULT_LIMIT = 50;
const SNIPPET_TOKENS = 16;
const PLAIN_SNIPPET_CHARS = 160;

interface Row {
  id: string;
  title: string;
  c: number;
  u: number;
  fid: string | null;
  fav: number;
  rid: number;
  r: number;
}
const cursorSchema = z
  .object({
    s: z.enum(['relevance', 'updated', 'created', 'title']),
    d: z.enum(['asc', 'desc']),
    k: z.union([z.string(), z.number()]),
    id: z.string(),
  })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;

const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(s: string): Cursor | undefined {
  try {
    const p = cursorSchema.safeParse(JSON.parse(Buffer.from(s, 'base64url').toString('utf8')));
    return p.success ? p.data : undefined;
  } catch {
    return undefined;
  }
}

/** Case- and diacritic-insensitive sort key (Unicode-aware, locale independent). */
export const titleKey = (t: string): string =>
  t.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** Index trouble while querying: mark the index dirty instead of failing the search. */
const indexError = (e: unknown): boolean => {
  const x = e as { code?: unknown; message?: unknown };
  const code = typeof x?.code === 'string' ? x.code : '';
  return (
    code === 'SQLITE_CORRUPT_VTAB' ||
    (code === 'SQLITE_ERROR' && /fts5|note_fts/i.test(String(x?.message ?? '')))
  );
};

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
}
/** The folder and every descendant. */
function subtreeIds(children: Map<string | null, string[]>, roots: string[]): string[] {
  const out = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop()!;
    if (out.has(f)) continue;
    out.add(f);
    stack.push(...(children.get(f) ?? []));
  }
  return [...out];
}

export function createSearch(store: Store, admin: IndexAdmin) {
  const db: Db = store.db;

  function run(p: z.output<typeof searchParamsSchema>): Result<SearchPage> {
    const st = admin.status();
    if (!st.ok) return st;
    if (st.value.state === 'error')
      return ok({ state: 'error', hits: [], messages: [st.value.message] });
    if (st.value.state !== 'ready') {
      const total = (db.prepare('SELECT count(*) AS c FROM notes').get() as { c: number }).c;
      return ok({
        state: 'rebuilding',
        progress: st.value.state === 'rebuilding' ? st.value.progress : { done: 0, total },
        hits: [],
        messages: ['The search index is being rebuilt. Results will appear in a moment.'],
      });
    }

    const parsed = parseQuery(p.query);
    const messages = [...parsed.messages];
    const scope = p.scope ?? { kind: 'all' as const };
    const f = p.filters ?? {};
    const match = toFtsMatch(parsed);
    const exclude = match ? null : toFtsExclude(parsed);
    const constrained =
      scope.kind !== 'all' ||
      Object.values(f).some((v) => v !== undefined) ||
      parsed.tagFilters.length > 0 ||
      parsed.folderFilters.length > 0;
    if (!match && !exclude && !constrained) {
      return ok({ state: 'ready', hits: [], messages });
    }
    if (constrained)
      messages.splice(
        0,
        messages.length,
        ...messages.filter((m) => m !== 'Type something to search.'),
      );

    // Folder tree once: subtree scopes, folder: names, and the derived trashed set share it.
    const folders = db.prepare('SELECT id, parent_id, name FROM folders').all() as FolderRow[];
    const children = new Map<string | null, string[]>();
    for (const fo of folders) {
      const l = children.get(fo.parent_id) ?? [];
      l.push(fo.id);
      children.set(fo.parent_id, l);
    }
    const trashedIds = trashedFolderIds(db);

    const where: string[] = [];
    const args: unknown[] = [];
    // Same derivation as notes.list: a root note (NULL folder) must not vanish under NOT IN.
    where.push(
      scope.kind === 'trash'
        ? '(n.trashed_at IS NOT NULL OR n.folder_id IN (SELECT value FROM json_each(?)))'
        : '(n.trashed_at IS NULL AND (n.folder_id IS NULL OR n.folder_id NOT IN (SELECT value FROM json_each(?))))',
    );
    args.push(JSON.stringify([...trashedIds]));
    const inFolders = (ids: string[]): void => {
      where.push('n.folder_id IN (SELECT value FROM json_each(?))');
      args.push(JSON.stringify(ids));
    };
    const hasTag = (tagId: string): void => {
      where.push('EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = ?)');
      args.push(tagId);
    };
    if (scope.kind === 'favorites') where.push('n.favorite = 1');
    if (scope.kind === 'tag') hasTag(scope.id!);
    if (scope.kind === 'folder') inFolders(subtreeIds(children, [scope.id!]));

    for (const t of f.tagIds ?? []) hasTag(t);
    if (f.folderIds?.length) inFolders(subtreeIds(children, f.folderIds));
    if (f.favorite !== undefined) where.push(f.favorite ? 'n.favorite = 1' : 'n.favorite = 0');
    const range = (col: string, from?: number, to?: number): void => {
      if (from !== undefined) {
        where.push(`n.${col} >= ?`);
        args.push(from);
      }
      if (to !== undefined) {
        where.push(`n.${col} <= ?`);
        args.push(to);
      }
    };
    range('created_at', f.createdFrom, f.createdTo);
    range('updated_at', f.updatedFrom, f.updatedTo);

    for (const name of parsed.tagFilters) {
      const row = db.prepare('SELECT id FROM tags WHERE name_key = ?').get(tagKey(name)) as
        { id: string } | undefined;
      if (row) hasTag(row.id);
      else {
        where.push('0');
        messages.push(`No tag named “${name}”.`);
      }
    }
    for (const name of parsed.folderFilters) {
      const key = tagKey(name);
      const named = folders.filter((fo) => tagKey(fo.name) === key).map((fo) => fo.id);
      // A trashed folder's notes are hidden outside the trash scope, so say so instead of showing nothing.
      const hit = scope.kind === 'trash' ? named : named.filter((x) => !trashedIds.has(x));
      if (hit.length) inFolders(subtreeIds(children, hit));
      else {
        where.push('0');
        messages.push(
          named.length
            ? `The folder “${name}” is in the trash.`
            : `No folder named “${name}”.`,
        );
      }
    }

    let sort: SearchSort = p.sort ?? (match ? 'relevance' : 'updated');
    if (sort === 'relevance' && !match) sort = 'updated';
    const dir = p.dir ?? (sort === 'title' ? 'asc' : 'desc');
    let cursor: Cursor | undefined;
    if (p.cursor) {
      cursor = decodeCursor(p.cursor);
      if (!cursor || cursor.s !== sort || cursor.d !== dir)
        return err('validation', 'This page cursor does not belong to this search.');
    }
    const limit = p.limit ?? DEFAULT_LIMIT;

    const cols = `n.id AS id, n.title AS title, n.created_at AS c, n.updated_at AS u, n.folder_id AS fid, n.favorite AS fav, d.rid AS rid`;
    let cte: string;
    const cteArgs: unknown[] = [];
    if (match) {
      cte = `WITH hit AS MATERIALIZED (SELECT ${cols}, note_fts.rank AS r FROM note_fts
        JOIN search_doc d ON d.rid = note_fts.rowid JOIN notes n ON n.id = d.note_id
        WHERE note_fts MATCH ? AND ${where.join(' AND ')})`;
      cteArgs.push(match, ...args);
    } else {
      const ex = exclude
        ? ' AND d.rid NOT IN (SELECT rowid FROM note_fts WHERE note_fts MATCH ?)'
        : '';
      cte = `WITH hit AS NOT MATERIALIZED (SELECT ${cols}, 0 AS r FROM notes n
        JOIN search_doc d ON d.note_id = n.id WHERE ${where.join(' AND ')}${ex})`;
      cteArgs.push(...args);
      if (exclude) cteArgs.push(exclude);
    }

    // Cursor caveat: a relevance cursor holds the bm25 rank of the last hit. Rank depends on corpus
    // statistics, so concurrent writes between two pages can shift ranks and a page may repeat or skip a
    // hit. Date and title sorts have stable keys. Documented in docs/architecture/search.md.
    const keyOf = (r: Row): string | number =>
      sort === 'relevance'
        ? r.r
        : sort === 'updated'
          ? r.u
          : sort === 'created'
            ? r.c
            : titleKey(r.title);
    let rows: Row[];
    try {
      if (sort === 'title') {
        // shortcut: sorts in JS (SQLite has no Unicode-aware collation here); fine to a few 10k matches, move to a stored sort key beyond.
        const all = db.prepare(`${cte} SELECT * FROM hit`).all(...cteArgs) as Row[];
        const keyed = all.map((r) => ({ r, k: titleKey(r.title) }));
        const sgn = dir === 'asc' ? 1 : -1;
        const cmp = (a: { r: Row; k: string }, b: { k: string; id: string }): number =>
          a.k < b.k ? -sgn : a.k > b.k ? sgn : a.r.id < b.id ? -1 : a.r.id > b.id ? 1 : 0;
        keyed.sort((a, b) => cmp(a, { k: b.k, id: b.r.id }));
        const after = cursor
          ? keyed.filter((x) => cmp(x, { k: String(cursor.k), id: cursor.id }) > 0)
          : keyed;
        rows = after.slice(0, limit + 1).map((x) => x.r);
      } else {
        const key = sort === 'relevance' ? 'r' : sort === 'updated' ? 'u' : 'c';
        // bm25 is smaller for better matches, so "best first" (desc) is ascending rank.
        const asc = sort === 'relevance' ? dir === 'desc' : dir === 'asc';
        const cond = cursor ? `WHERE (${key} ${asc ? '>' : '<'} ? OR (${key} = ? AND id > ?))` : '';
        const cargs = cursor ? [cursor.k, cursor.k, cursor.id] : [];
        rows = db
          .prepare(
            `${cte} SELECT * FROM hit ${cond} ORDER BY ${key} ${asc ? 'ASC' : 'DESC'}, id LIMIT ?`,
          )
          .all(...cteArgs, ...cargs, limit + 1) as Row[];
      }
    } catch (e) {
      if (!indexError(e)) throw e;
      admin.markDirty('query hit a damaged index');
      return ok({
        state: 'rebuilding',
        progress: { done: 0, total: 0 },
        hits: [],
        messages: ['The search index is damaged and is being rebuilt.'],
      });
    }

    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const out: SearchPage = {
      state: 'ready',
      hits: [],
      messages,
    };
    if (more && last)
      out.nextCursor = encodeCursor({ s: sort, d: dir, k: keyOf(last), id: last.id });

    // Highlights only for this page (<= 100 rows).
    const marked = new Map<number, { t: string | null; s: string | null }>();
    // A hit that exists only in an attachment's text (a PDF) shows the attachment snippet instead.
    const plain = new Map<string, string>();
    if (page.length) {
      const ids = JSON.stringify(page.map((r) => r.rid));
      if (match) {
        const hl = db
          .prepare(
            `SELECT rowid AS rid, highlight(note_fts, 0, ?, ?) AS t, snippet(note_fts, 1, ?, ?, '…', ${SNIPPET_TOKENS}) AS s,
                    snippet(note_fts, 3, ?, ?, '…', ${SNIPPET_TOKENS}) AS a
             FROM note_fts WHERE note_fts MATCH ? AND rowid IN (SELECT value FROM json_each(?))`,
          )
          .all(MARK_OPEN, MARK_CLOSE, MARK_OPEN, MARK_CLOSE, MARK_OPEN, MARK_CLOSE, match, ids) as {
          rid: number;
          t: string | null;
          s: string | null;
          a: string | null;
        }[];
        for (const h of hl)
          marked.set(h.rid, {
            t: h.t,
            s: h.s && h.s.includes(MARK_OPEN) ? h.s : h.a && h.a.includes(MARK_OPEN) ? h.a : h.s,
          });
      } else {
        const bodies = db
          .prepare(
            `SELECT id, substr(body, 1, ${PLAIN_SNIPPET_CHARS}) AS b FROM notes WHERE id IN (SELECT value FROM json_each(?))`,
          )
          .all(JSON.stringify(page.map((r) => r.id))) as { id: string; b: string }[];
        for (const b of bodies) plain.set(b.id, b.b);
      }
    }
    out.hits = page.map((r): SearchHit => {
      const m = marked.get(r.rid);
      const title = rangesFromMarked(m?.t ?? stripMarkerChars(r.title), MARK_OPEN, MARK_CLOSE);
      const snippet = rangesFromMarked(
        m?.s ?? stripMarkerChars(plain.get(r.id) ?? ''),
        MARK_OPEN,
        MARK_CLOSE,
      );
      return {
        noteId: r.id,
        title,
        snippet,
        updatedAt: r.u,
        createdAt: r.c,
        folderId: r.fid,
        favorite: r.fav === 1,
        trashed: scope.kind === 'trash',
      };
    });
    return ok(out);
  }

  return {
    search(raw: unknown): Result<SearchPage> {
      const p = parse(searchParamsSchema, raw);
      if (!p.ok) return p;
      return safe(() => run(p.value));
    },
  };
}
