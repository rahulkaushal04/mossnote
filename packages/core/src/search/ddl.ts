/**
 * The search DDL owned by the rebuild (decision C4). Migration 0002 shipped a 3-column table and nine
 * triggers; migration 0003 only drops those triggers and marks the index dirty. The rebuild then
 * re-creates the FTS table (4 columns: title, body, tags, att) and all twelve triggers from here, so a
 * fresh database and an upgraded one converge on the same schema. Pure strings, no store code.
 */

/** Strips the highlight marker characters from indexed text so they cannot forge highlights. */
const X = (v: string): string => `replace(replace(${v}, char(2), ' '), char(3), ' ')`;
/** Space-joined tag names of one note in name_key order, marker-stripped. */
const TAGS = (noteId: string): string =>
  `coalesce((SELECT group_concat(${X('t.name')}, ' ' ORDER BY t.name_key) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ${noteId}), '')`;
/** Extracted text of the attachments of one note (any ref, trashed notes included), marker-stripped. */
const ATT = (noteId: string): string =>
  `coalesce((SELECT group_concat(${X('a.text')}, ' ' ORDER BY a.sha256) FROM note_attachments na JOIN attachments a ON a.sha256 = na.sha256 WHERE na.note_id = ${noteId} AND a.text <> ''), '')`;
/** Triggers run while the index is trusted ('ok') or being refilled ('rebuilding'; see rebuild.ts). */
const LIVE = `coalesce((SELECT value FROM meta WHERE key = 'search_state'), '') IN ('ok', 'rebuilding')`;
const DOC_TAGS = (id: string): string =>
  `UPDATE search_doc SET tags = ${TAGS(id)} WHERE note_id = ${id};`;
const DOC_ATT = (id: string): string =>
  `UPDATE search_doc SET att = ${ATT(id)} WHERE note_id = ${id};`;
/** FTS5 'delete' command values for a note whose old indexed text is given. */
const DEL = (rid: string, title: string, body: string, tags: string, att: string): string =>
  `'delete', ${rid}, ${X(title)}, ${X(body)}, ${tags}, ${att}`;

/** FTS5 table plus its settings. secure-delete is set OFF once, here, and never toggled (toggling corrupts the index). */
export const SEARCH_FTS_SQL = `
CREATE VIRTUAL TABLE note_fts USING fts5(title, body, tags, att, content='search_src', content_rowid='rid',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3');
INSERT INTO note_fts(note_fts, rank) VALUES ('rank', 'bm25(10.0, 1.0, 5.0, 0.5)');
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
  'search_na_ai',
  'search_na_ad',
  'search_att_au',
] as const;

export const SEARCH_TRIGGERS_SQL = `
-- REPLACE/IGNORE/UPSERT safe without recursive_triggers: stash the old values before an insert, consume after.
CREATE TRIGGER search_notes_bi BEFORE INSERT ON notes WHEN ${LIVE} BEGIN
  DELETE FROM search_stash WHERE note_id = new.id;
  INSERT INTO search_stash(note_id, title, body, tags, att)
    SELECT d.note_id, ${X('n.title')}, ${X('n.body')}, d.tags, d.att
    FROM search_doc d JOIN notes n ON n.id = d.note_id WHERE d.note_id = new.id;
END;
CREATE TRIGGER search_notes_ai AFTER INSERT ON notes WHEN ${LIVE} BEGIN
  INSERT INTO note_fts(note_fts, rowid, title, body, tags, att)
    SELECT 'delete', d.rid, s.title, s.body, s.tags, s.att FROM search_stash s JOIN search_doc d ON d.note_id = s.note_id WHERE s.note_id = new.id;
  DELETE FROM search_doc WHERE note_id = new.id;
  DELETE FROM search_stash WHERE note_id = new.id;
  INSERT INTO search_doc(note_id, tags, att) VALUES (new.id, ${TAGS('new.id')}, ${ATT('new.id')});
  INSERT INTO note_fts(rowid, title, body, tags, att)
    SELECT d.rid, ${X('new.title')}, ${X('new.body')}, d.tags, d.att FROM search_doc d WHERE d.note_id = new.id;
END;
-- Fires on every update so an UPSERT that changed nothing indexed still drops its stash row (the stash must not retain note text).
CREATE TRIGGER search_notes_au AFTER UPDATE ON notes WHEN ${LIVE} BEGIN
  DELETE FROM search_stash WHERE note_id = old.id;
  INSERT INTO note_fts(note_fts, rowid, title, body, tags, att)
    SELECT ${DEL('d.rid', 'old.title', 'old.body', 'd.tags', 'd.att')} FROM search_doc d
    WHERE d.note_id = old.id AND (old.title IS NOT new.title OR old.body IS NOT new.body);
  INSERT INTO note_fts(rowid, title, body, tags, att)
    SELECT d.rid, ${X('new.title')}, ${X('new.body')}, d.tags, d.att FROM search_doc d
    WHERE d.note_id = old.id AND (old.title IS NOT new.title OR old.body IS NOT new.body);
END;
CREATE TRIGGER search_notes_bd BEFORE DELETE ON notes WHEN ${LIVE} BEGIN
  DELETE FROM search_stash WHERE note_id = old.id;
  INSERT INTO note_fts(note_fts, rowid, title, body, tags, att)
    SELECT ${DEL('d.rid', 'old.title', 'old.body', 'd.tags', 'd.att')} FROM search_doc d WHERE d.note_id = old.id;
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
CREATE TRIGGER search_doc_au AFTER UPDATE OF tags, att ON search_doc
WHEN (old.tags IS NOT new.tags OR old.att IS NOT new.att) AND ${LIVE} BEGIN
  INSERT INTO note_fts(note_fts, rowid, title, body, tags, att)
    SELECT ${DEL('old.rid', 'n.title', 'n.body', 'old.tags', 'old.att')} FROM notes n WHERE n.id = old.note_id;
  INSERT INTO note_fts(rowid, title, body, tags, att)
    SELECT new.rid, ${X('n.title')}, ${X('n.body')}, new.tags, new.att FROM notes n WHERE n.id = new.note_id;
END;
-- Attachment text reaches the index through search_doc.att; these three keep that column exact.
CREATE TRIGGER search_na_ai AFTER INSERT ON note_attachments WHEN ${LIVE} BEGIN ${DOC_ATT('new.note_id')} END;
CREATE TRIGGER search_na_ad AFTER DELETE ON note_attachments WHEN ${LIVE} BEGIN ${DOC_ATT('old.note_id')} END;
CREATE TRIGGER search_att_au AFTER UPDATE OF text ON attachments WHEN old.text IS NOT new.text AND ${LIVE} BEGIN
  UPDATE search_doc SET att = ${ATT('search_doc.note_id')}
    WHERE note_id IN (SELECT note_id FROM note_attachments WHERE sha256 = new.sha256);
END;
`;

/** Tag aggregate for the rebuild's refill. */
export const SEARCH_TAGS_EXPR = TAGS;
/** Attachment-text aggregate for the rebuild's refill. */
export const SEARCH_ATT_EXPR = ATT;
