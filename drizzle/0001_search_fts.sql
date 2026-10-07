-- Full-text index (spec sections 9 and 16). Drizzle does not model virtual tables, so this is a
-- hand-written migration. Rows are maintained by the application in the same transaction as every
-- data write (reindex / unindex); there are no triggers.
-- Columns, in order: kind, ref_id, title, body, tags, extra. The bm25 weights used by search,
-- bm25(search_fts, 0, 0, 10, 1, 4, 2), line up with this column order.
CREATE VIRTUAL TABLE `search_fts` USING fts5(
  kind UNINDEXED, ref_id UNINDEXED,
  title, body, tags, extra,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_vocab` USING fts5vocab(search_fts, 'row');
