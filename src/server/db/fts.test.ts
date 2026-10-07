import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './client';
import { BM25_WEIGHTS, FTS_COLUMNS } from './fts';
import { migratedMemoryDatabase } from '../testing/helpers';

let database: Database;
beforeEach(async () => {
  database = await migratedMemoryDatabase();
});
afterEach(() => {
  database.sqlite.close();
});

interface Doc {
  ref: string;
  title?: string;
  body?: string;
  tags?: string;
  extra?: string;
}
const add = (doc: Doc) =>
  database.sqlite
    .prepare(
      'INSERT INTO search_fts (kind, ref_id, title, body, tags, extra) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('note', doc.ref, doc.title ?? '', doc.body ?? '', doc.tags ?? '', doc.extra ?? '');
const match = (expression: string) =>
  (
    database.sqlite
      .prepare('SELECT ref_id FROM search_fts WHERE search_fts MATCH ? ORDER BY ref_id')
      .all(expression) as { ref_id: string }[]
  ).map((r) => r.ref_id);
const ranked = (expression: string) =>
  (
    database.sqlite
      .prepare(
        `SELECT ref_id FROM search_fts WHERE search_fts MATCH ? ORDER BY bm25(search_fts, ${BM25_WEIGHTS.join(', ')})`,
      )
      .all(expression) as { ref_id: string }[]
  ).map((r) => r.ref_id);

describe('search_fts table', () => {
  it('has the columns in the order the bm25 weights assume', () => {
    const columns = (
      database.sqlite.prepare("SELECT name FROM pragma_table_info('search_fts')").all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    expect(columns).toEqual([...FTS_COLUMNS]);
    expect(BM25_WEIGHTS).toHaveLength(FTS_COLUMNS.length);
  });

  it('was created with the unicode61 tokenizer and prefix indexes 2 and 3', () => {
    const row = database.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'search_fts'")
      .get() as { sql: string };
    expect(row.sql).toContain('unicode61 remove_diacritics 2');
    expect(row.sql).toMatch(/prefix\s*=\s*'2 3'/);
  });

  it('is compiled into the bundled SQLite build', () => {
    const options = (
      database.sqlite.prepare('PRAGMA compile_options').all() as { compile_options: string }[]
    ).map((r) => r.compile_options);
    expect(options).toContain('ENABLE_FTS5');
  });
});

describe('matching', () => {
  it('matches case-insensitively', () => {
    add({ ref: 'a', body: 'The Harbour at dusk' });
    expect(match('"harbour"')).toEqual(['a']);
    expect(match('"HARBOUR"')).toEqual(['a']);
  });

  it('matches by prefix, including 2 and 3 character prefixes', () => {
    add({ ref: 'a', body: 'a quiet harbour' });
    expect(match('"harb"*')).toEqual(['a']);
    expect(match('"har"*')).toEqual(['a']);
    expect(match('"ha"*')).toEqual(['a']);
    expect(match('"harx"*')).toEqual([]);
  });

  it('strips diacritics on both sides', () => {
    add({ ref: 'a', body: 'résumé of the café' });
    add({ ref: 'b', body: 'plain cafe' });
    expect(match('"resume"')).toEqual(['a']);
    expect(match('"café"')).toEqual(['a', 'b']);
    expect(match('"cafe"')).toEqual(['a', 'b']);
  });

  it('is not order sensitive and requires every word', () => {
    add({ ref: 'a', body: 'lantern near the harbour' });
    add({ ref: 'b', body: 'only a lantern' });
    expect(match('"harbour" "lantern"')).toEqual(['a']);
    expect(match('"lantern" "harbour"')).toEqual(['a']);
  });

  it('supports phrases and exclusion', () => {
    add({ ref: 'a', body: 'a quiet corner of the map' });
    add({ ref: 'b', body: 'a corner that is quiet' });
    expect(match('"quiet corner"')).toEqual(['a']);
    expect(match('"corner" NOT "map"')).toEqual(['b']);
  });

  it('quoted terms cannot act as operators', () => {
    add({ ref: 'a', body: 'one and two' });
    add({ ref: 'b', body: 'one only' });
    expect(match('"one" "and" "two"')).toEqual(['a']);
    expect(match('"OR"')).toEqual([]);
    expect(match('"NOT"')).toEqual([]);
  });

  it('does not index the UNINDEXED columns', () => {
    add({ ref: 'findme-ref', body: 'something else' });
    expect(match('"findme"*')).toEqual([]);
    expect(match('ref_id : "findme"*')).toEqual([]);
  });

  it('removes a document when its row is deleted', () => {
    add({ ref: 'a', body: 'lantern' });
    database.sqlite.prepare("DELETE FROM search_fts WHERE ref_id = 'a'").run();
    expect(match('"lantern"')).toEqual([]);
  });
});

describe('bm25 column weights (kind 0, ref_id 0, title 10, body 1, tags 4, extra 2)', () => {
  it('ranks a title match above a tag match above an extra match above a body match', () => {
    add({ ref: 'body', title: 'filler', body: 'lantern' });
    add({ ref: 'extra', title: 'filler', extra: 'lantern' });
    add({ ref: 'tags', title: 'filler', tags: 'lantern' });
    add({ ref: 'title', title: 'lantern', body: '' });
    expect(ranked('"lantern"')).toEqual(['title', 'tags', 'extra', 'body']);
  });
});

describe('search_vocab', () => {
  it('lists terms with document counts for typo tolerance', () => {
    add({ ref: 'a', body: 'harbour lantern' });
    add({ ref: 'b', body: 'harbour' });
    const rows = database.sqlite
      .prepare(
        "SELECT term, doc FROM search_vocab WHERE term IN ('harbour', 'lantern') ORDER BY term",
      )
      .all();
    expect(rows).toEqual([
      { term: 'harbour', doc: 2 },
      { term: 'lantern', doc: 1 },
    ]);
  });

  it('stores terms lowercase and without diacritics', () => {
    add({ ref: 'a', body: 'Café Résumé' });
    const terms = (
      database.sqlite.prepare('SELECT term FROM search_vocab ORDER BY term').all() as {
        term: string;
      }[]
    ).map((r) => r.term);
    expect(terms).toEqual(['cafe', 'resume']);
  });
});
