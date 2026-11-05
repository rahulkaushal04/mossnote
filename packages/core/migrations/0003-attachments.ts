import type { Migration } from './types.ts';

// Attachments (AT-1..AT-10). Tables and columns only (decision C4): the FTS table and the search
// triggers are NOT touched here beyond dropping the nine 0002 triggers. The index is marked dirty and the
// chunked rebuild (src/search/rebuild.ts, DDL in src/search/ddl.ts) re-creates the 4-column FTS table
// and all twelve triggers. A plain DROP TABLE note_fts in a migration could lock the user out when the
// index is damaged (SR-9).
//
// attachments is a content-addressed cache row, not a synced entity: no ULID or updated_at (the
// sha256 is the identity). note_attachments rows are the synced entity 'attachment_ref'.
// The old triggers read search_stash/search_doc with 3-column values, so they must go BEFORE the
// ALTERs; the view is re-created with the new column.
const sql = `
CREATE TABLE attachments (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size INTEGER NOT NULL CHECK (size >= 0),
  mime TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','svg','pdf','text','html','audio','video','executable','other')),
  text TEXT NOT NULL DEFAULT '',
  text_state TEXT NOT NULL DEFAULT 'none' CHECK (text_state IN ('none','pending','done','failed')),
  verify_state TEXT NOT NULL DEFAULT 'ok' CHECK (verify_state IN ('ok','missing','corrupt')),
  verified_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE note_attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL REFERENCES attachments(sha256),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  created_at INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  UNIQUE (note_id, sha256)
) STRICT;
CREATE INDEX note_attachments_sha ON note_attachments(sha256);

DROP TRIGGER IF EXISTS search_notes_bi;
DROP TRIGGER IF EXISTS search_notes_ai;
DROP TRIGGER IF EXISTS search_notes_au;
DROP TRIGGER IF EXISTS search_notes_bd;
DROP TRIGGER IF EXISTS search_nt_ai;
DROP TRIGGER IF EXISTS search_nt_ad;
DROP TRIGGER IF EXISTS search_nt_au;
DROP TRIGGER IF EXISTS search_tags_au;
DROP TRIGGER IF EXISTS search_doc_au;

DROP VIEW search_src;
ALTER TABLE search_doc ADD COLUMN att TEXT NOT NULL DEFAULT '';
ALTER TABLE search_stash ADD COLUMN att TEXT;
CREATE VIEW search_src AS SELECT d.rid AS rid, replace(replace(n.title, char(2), ' '), char(3), ' ') AS title,
  replace(replace(n.body, char(2), ' '), char(3), ' ') AS body, d.tags AS tags, d.att AS att
  FROM search_doc d JOIN notes n ON n.id = d.note_id;

INSERT INTO meta(key, value) VALUES ('search_state', 'dirty'), ('search_dirty_reason', 'migration 0003')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
`;

export default { version: 3, name: 'attachments', sql } satisfies Migration;
