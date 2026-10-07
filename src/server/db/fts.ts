/**
 * Column order of the `search_fts` virtual table, as created in drizzle/0001_search_fts.sql.
 * `bm25()` takes one weight per column in this order, including the two UNINDEXED columns.
 */
export const FTS_COLUMNS = ['kind', 'ref_id', 'title', 'body', 'tags', 'extra'] as const;

/** Weights for `bm25(search_fts, ...)`: kind, ref_id, title, body, tags, extra. */
export const BM25_WEIGHTS = [0, 0, 10, 1, 4, 2] as const;
