# Full-text search: design, damage handling and guarantees

Status: implemented in `packages/core/src/search/**`, `packages/core/migrations/0002-search.ts`,
`store/store.ts` (write retry), `integrity/check.ts` (startup verdict). Spec: `SPEC-search.md`.
Evidence: the Stage 0 spike (`.claude/work/search/spike.md`) and fix round 1.

## Design

- One FTS5 table, `note_fts(title, body, tags)`, as **external content over a view** (`search_src`), not a
  copy of the text: the index is about half the size of a self-contained table and purged text has no second
  home. Tokenizer `unicode61 remove_diacritics 2`, prefix indexes `'2 3'`, bm25 weights `10, 1, 5`.
- `search_doc(rid, note_id, tags)` maps a note to the integer rowid FTS5 needs and holds the denormalised,
  marker-stripped tag string (tags are the third column). `search_stash` is described below.
- Display text (titles, snippets) always comes from the marker-stripped `highlight()`/`snippet()` output,
  never from `notes.body`: NUL is dropped and lone surrogates become U+FFFD inside SQLite, so offsets taken
  against the original body would drift. Ranges are UTF-16 offsets into the returned text.
- Visibility reuses the `notes.list` derivation: default scopes hide trashed notes and notes inside trashed
  folders (root notes have a NULL folder and must not vanish under `NOT IN`); scope `trash` shows only those.
- Writes are never debounced: the index is consistent inside the same transaction as the note change.

## Triggers

Nine triggers (`SEARCH_TRIGGER_NAMES`) keep the index exact for every writer (notes, note_tags, tags rename
and merge, trash/restore, version restore, purge, `applyRemote`). They run only while `meta.search_state` is
`ok` or `rebuilding` (`LIVE`). `INSERT OR REPLACE` does not fire DELETE triggers without `recursive_triggers`
(which stays off), hence the stash pair:

- `search_notes_bi` (BEFORE INSERT) copies the note's current indexed text into `search_stash`.
- `search_notes_ai` (AFTER INSERT) issues the FTS5 `'delete'` for that old text, re-creates the doc row, drops
  the stash row and indexes the new text.
- `search_notes_au` fires on EVERY update (not only title/body) and drops the stash row first, so an UPSERT
  (`ON CONFLICT DO UPDATE`) that changed nothing indexed still consumes it. `search_notes_bd` drops it on delete.
- An `INSERT OR IGNORE` that is ignored fires no AFTER trigger, so it leaves one stash row. That row holds the
  note's CURRENT text (the insert changed nothing), never older or deleted text; the next change to the note,
  its deletion, or any purge (`afterPurge` runs `DELETE FROM search_stash`) removes it. The property test asserts
  exactly this invariant after every random sequence.

## Rebuild

`search.rebuild` (RPC) / `ws.search.requestRebuild()` marks the index dirty and the dispatcher's pump runs it;
`ws.search.rebuild()` loops it synchronously (tests, CLI).

1. `start()` first runs `indexVerdict` (a FULL `quick_check`, see below) and refuses with `corrupt` when the
   base tables are damaged: `DROP TABLE` plus `secure_delete` would otherwise zero live pages.
2. It drops the triggers, drops and re-creates the FTS table (using `unsafeMode` plus restoring the config
   `version` row when a damaged config row blocks `DROP`), re-creates the triggers, sets `rank` and
   `secure-delete` OFF, and sets state `rebuilding`.
3. It refills in slices of 500 rows with a progress marker in `meta`. Triggers are live during the refill, so
   writes made meanwhile are indexed by the triggers; the refill only adds notes with no `search_doc` row yet.
   Queries during a rebuild answer `{state:'rebuilding', progress}`.

Failure policy (per session): one automatic retry after a failed step, then state `error` (core status and the
`searchState` event, with a message). In `error` the pump does not restart and searches reply `state:'error'`.
Only `search.rebuild` (the "Rebuild search index" command) or an app restart re-arms it.

`verify()` (deep `integrity-check` with content comparison) is blocking and O(index size): run it on demand,
not per keystroke. While the index is not `ok` it reports `{ok:true, skipped:true}`. It was not sliced; measure
at 20k notes before wiring it to anything automatic.

## Damage handling and its limits

Detection points: startup (`integrity/check.ts`), failed writes (`store.mutate` / `applyRemote`), failed
queries, and `verify()`. The rule that decides "index only" versus "real corruption" is the important part.

### The startup rule (BLOCKER 1)

Experiment (scratch scripts, SQLite 3.53.4, better-sqlite3 13): `PRAGMA quick_check(<table>)` skips page
accounting. Observed: a freelist trunk page with an impossible leaf count passes `quick_check(notes)` and
`quick_check(note_fts)` as `ok` while the FULL check reports `Freelist: freelist leaf count too big`; a
`note_fts_data` root pointed at the `notes` root page passes `quick_check(notes)` as `ok` while the FULL check
reports `2nd reference to page N` plus "never used" rows. A table-restricted check therefore cannot prove the
database healthy, and treating "base tables pass" as "index only" would let the rebuild's DROP + secure_delete
overwrite live `notes` pages.

Final rule. Damage is **index only** only when the evidence is attributable to the FTS tables by logical
damage:

- the thrown fts5 `SQLITE_ERROR` (damaged `note_fts_config` row, "run 'rebuild'"), after which the full check is
  repeated on an in-memory copy with the config row restored (the config error aborts the check before page
  accounting runs); or
- FULL `quick_check` rows that all name `note_fts*`, `search_doc`, `search_stash` or their autoindexes, and no
  row starts with `***`.

Everything else is **real corruption** and opens recovery mode: any freelist, unused-page or double-reference
row, any unnamed `Tree ...` row, any thrown `SQLITE_CORRUPT`, including a ruined page inside a shadow table
(it cannot be dropped in place). Logical shadow-table damage that `quick_check` cannot see (zeroed structure
row, deleted `_idx`/`_docsize` rows) is found by the write retry or `verify()`.

### The write retry (MAJOR 1, 7)

A failed write that looks index-caused (`SQLITE_CORRUPT*`, `SQLITE_CONSTRAINT_PRIMARYKEY`, fts5
`SQLITE_ERROR`) is retried once with the triggers dropped, and the index marked dirty, ONLY if
`PRAGMA quick_check(<t>)` passes for every base table a trigger reads or the write touches (`notes`,
`note_tags`, `tags`, `search_doc`, `folders`, `versions`, `drafts`). Otherwise the original `corrupt` error is
returned. `applyRemote` uses the same wrapper. Limit: this probe is table-restricted, so a corrupt freelist or a
cross-link is not caught by it; those are caught at the next startup (full check) and before any rebuild.
The dispatcher starts the rebuild pump after every mutating call, so a quarantine is acted on at once.

## Purge guarantee

After a purge (`purgeBatch`, `purgeExpired`, empty trash) or a tag merge the store runs, once the commit is
done: FTS5 `optimize` (merges to one segment so deleted terms leave the file), `DELETE FROM search_stash`, and
`wal_checkpoint(TRUNCATE)`. `purgeExpired` does this once per batch (`Store.batch`), a single purge at once.

Secure-delete decision: FTS5 `secure-delete` is OFF (set once at creation, never toggled: toggling corrupts
the index). With it ON an autosave cost 15-21 ms and renaming a tag with 1,000 notes 4.5 s versus 0.2-1.3 ms and
0.27 s. Database-level `secure_delete=ON` stays. Ordinary edits keep old text in `versions` anyway; the guarantee
that matters is purge. Tests assert (a) no query matches, (b) `fts5vocab` has no row, (c) a byte scan of db and
WAL finds nothing (with a sanity step proving the bytes were there before), (d) the stash is empty.
`optimize` cost at 100k notes is measured by the benchmark stage; chunk it through the pump only if it exceeds
about 500 ms there.

## Known limits and trade-offs

- **CJK (user-facing wording):** "Chinese, Japanese and Korean text is matched from the start of a run of
  characters, so searching 日本 finds 日本語 but searching 本語 does not. Add a space around the word you want,
  or search for the beginning of it." (`unicode61` has no word boundaries for these scripts; no trigram table.)
- **Relevance cursors drift:** a relevance cursor holds the bm25 rank of the last hit. Rank depends on corpus
  statistics, so writes between two page loads can shift ranks and a hit may repeat or be skipped. Date and
  title sorts have stable keys and do not drift.
- **Saved searches may contain purged words.** They are local settings (`meta.saved_searches`, not in the
  change log) and keep the query text the user typed. Purge does not edit them. Entries with unknown keys from
  a newer version still list and keep those keys when renamed.
- **Open results are not patched:** a note renamed while open is not re-titled in the shown results on content
  events (own autosaves are ignored by the search store); structural events reload the loaded pages. Accepted.
- **`-tag:` / `-folder:` exclusion** is not in v1: the rest of the query runs with a message.
- **Filter registry gap for later modules.** Filters (`tagIds`, `folderIds`, dates, `favorite`) are fixed in
  `params.ts`/`search.ts`; there is no registry. Attachments, tasks or properties each need: a migration adding
  their text to the indexed columns (or a new column, which means re-creating `note_fts`, the view and the
  triggers, i.e. a new migration plus a dirty-and-rebuild), triggers for their tables, new filter keys in
  `filtersSchema` and `storedSpecSchema`, and an entry in the damage probe's table list.
