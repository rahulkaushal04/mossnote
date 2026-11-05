import type { Migration } from './types.ts';

// Full-text search (SR-1..SR-9). Schema only: an upgraded database that already has notes starts
// with search_state='dirty' and is filled by the chunked rebuild (src/search/rebuild.ts), never here.
// The pieces are exported because the rebuild re-creates the FTS table and the triggers verbatim.

/** Strips the highlight marker characters from indexed text so they cannot forge highlights. */
const X = (v: string): string => `replace(replace(${v}, char(2), ' '), char(3), ' ')`;
/** Space-joined tag names of one note in name_key order (so phrases over tags are deterministic), marker-stripped. */
const TAGS = (noteId: string): string =>
  `coalesce((SELECT group_concat(${X('t.name')}, ' ' ORDER BY t.name_key) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ${noteId}), '')`;
/** Triggers run while the index is trusted ('ok') or being refilled ('rebuilding'; see rebuild.ts). */
const LIVE = `coalesce((SELECT value FROM meta WHERE key = 'search_state'), '') IN ('ok', 'rebuilding')`;
const DOC_TAGS = (id: string): string =>
  `UPDATE search_doc SET tags = ${TAGS(id)} WHERE note_id = ${id};`;
/** FTS5 'delete' command row for a note whose old text is given. */
const DEL = (title: string, body: string, tags: string): string =>
  `'delete', d.rid, ${X(title)}, ${X(body)}, ${tags}`;

/** FTS5 table plus its settings. secure-delete is set OFF once, here, and never toggled (toggling corrupts the index). */
export const SEARCH_FTS_SQL = `
CREATE VIRTUAL TABLE note_fts USING fts5(title, body, tags, content='search_src', content_rowid='rid',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3');
INSERT INTO note_fts(note_fts, rank) VALUES ('rank', 'bm25(10.0, 1.0, 5.0)');
INSERT INTO note_fts(note_fts, rank) VALUES ('secure-delete', 0);
`;

export const SEARCH_TRIGGER_NAMES = [
  'search_notes_bi',
  'search_notes_ai',
  'search_notes_au',
  'search_notes_bd',
  'search_nt_ai',
  'search_nt_ad',
  'search_nt_au',
  'search_tags_au',
  'search_doc_au',
] as const;

export const SEARCH_TRIGGERS_SQL = `
-- REPLACE/IGNORE/UPSERT safe without recursive_triggers: stash the old values before an insert, consume after.
CREATE TRIGGER search_notes_bi BEFORE INSERT ON notes WHEN ${LIVE} BEGIN
  DELETE FROM search_stash WHERE note_id = new.id;
  INSERT INTO search_stash SELECT d.note_id, ${X('n.title')}, ${X('n.body')}, d.tags
    FROM search_doc d JOIN notes n ON n.id = d.note_id WHERE d.note_id = new.id;
END;
CREATE TRIGGER search_notes_ai AFTER INSERT ON notes WHEN ${LIVE} BEGIN
  INSERT INTO note_fts(note_fts, rowid, title, body, tags)
    SELECT 'delete', d.rid, s.title, s.body, s.tags FROM search_stash s JOIN search_doc d ON d.note_id = s.note_id WHERE s.note_id = new.id;
  DELETE FROM search_doc WHERE note_id = new.id;
  DELETE FROM search_stash WHERE note_id = new.id;
  INSERT INTO search_doc(note_id, tags) VALUES (new.id, ${TAGS('new.id')});
  INSERT INTO note_fts(rowid, title, body, tags)
    SELECT d.rid, ${X('new.title')}, ${X('new.body')}, d.tags FROM search_doc d WHERE d.note_id = new.id;
END;
-- Fires on every update so an UPSERT that changed nothing indexed still drops its stash row (the stash must not retain note text).
CREATE TRIGGER search_notes_au AFTER UPDATE ON notes WHEN ${LIVE} BEGIN
  DELETE FROM search_stash WHERE note_id = old.id;
  INSERT INTO note_fts(note_fts, rowid, title, body, tags)
    SELECT ${DEL('old.title', 'old.body', 'd.tags')} FROM search_doc d
    WHERE d.note_id = old.id AND (old.title IS NOT new.title OR old.body IS NOT new.body);
  INSERT INTO note_fts(rowid, title, body, tags)
    SELECT d.rid, ${X('new.title')}, ${X('new.body')}, d.tags FROM search_doc d
    WHERE d.note_id = old.id AND (old.title IS NOT new.title OR old.body IS NOT new.body);
END;
CREATE TRIGGER search_notes_bd BEFORE DELETE ON notes WHEN ${LIVE} BEGIN
  DELETE FROM search_stash WHERE note_id = old.id;
  INSERT INTO note_fts(note_fts, rowid, title, body, tags)
    SELECT ${DEL('old.title', 'old.body', 'd.tags')} FROM search_doc d WHERE d.note_id = old.id;
  DELETE FROM search_doc WHERE note_id = old.id;
END;
CREATE TRIGGER search_nt_ai AFTER INSERT ON note_tags WHEN ${LIVE} BEGIN ${DOC_TAGS('new.note_id')} END;
CREATE TRIGGER search_nt_ad AFTER DELETE ON note_tags WHEN ${LIVE} BEGIN ${DOC_TAGS('old.note_id')} END;
CREATE TRIGGER search_nt_au AFTER UPDATE ON note_tags WHEN ${LIVE} BEGIN
  ${DOC_TAGS('old.note_id')}
  ${DOC_TAGS('new.note_id')}
END;
CREATE TRIGGER search_tags_au AFTER UPDATE OF name ON tags WHEN old.name IS NOT new.name AND ${LIVE} BEGIN
  UPDATE search_doc SET tags = ${TAGS('search_doc.note_id')}
    WHERE note_id IN (SELECT note_id FROM note_tags WHERE tag_id = new.id);
END;
CREATE TRIGGER search_doc_au AFTER UPDATE OF tags ON search_doc WHEN old.tags IS NOT new.tags AND ${LIVE} BEGIN
  INSERT INTO note_fts(note_fts, rowid, title, body, tags)
    SELECT ${DEL('n.title', 'n.body', 'old.tags').replace('d.rid', 'old.rid')} FROM notes n WHERE n.id = old.note_id;
  INSERT INTO note_fts(rowid, title, body, tags)
    SELECT new.rid, ${X('n.title')}, ${X('n.body')}, new.tags FROM notes n WHERE n.id = new.note_id;
END;
`;

/** Tag aggregate for the rebuild's refill. */
export const SEARCH_TAGS_EXPR = TAGS;

const sql = `
CREATE TABLE search_doc (rid INTEGER PRIMARY KEY, note_id TEXT NOT NULL UNIQUE, tags TEXT NOT NULL DEFAULT '') STRICT;
CREATE VIEW search_src AS SELECT d.rid AS rid, ${X('n.title')} AS title, ${X('n.body')} AS body, d.tags AS tags
  FROM search_doc d JOIN notes n ON n.id = d.note_id;
CREATE TABLE search_stash (note_id TEXT PRIMARY KEY, title TEXT, body TEXT, tags TEXT) STRICT;
${SEARCH_FTS_SQL}
${SEARCH_TRIGGERS_SQL}
INSERT INTO meta(key, value) VALUES ('search_state', CASE WHEN EXISTS (SELECT 1 FROM notes) THEN 'dirty' ELSE 'ok' END);
`;

export default { version: 2, name: 'search', sql } satisfies Migration;
