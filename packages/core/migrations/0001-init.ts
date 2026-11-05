import type { Migration } from './types.ts';

// Once released, migrations are immutable (sha256 pinned in test/migrations/lock.test.ts): add 0002, never edit.
// Nothing had shipped when 0001 was last edited (core-store fix round 2: application_id).
const sql = `
PRAGMA application_id = 1297044307; -- APPLICATION_ID in store.ts ("MOSS")
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
INSERT INTO meta(key, value) VALUES ('sync_full_reconcile', '0'), ('trash_retention_days', '30');

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES folders(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, device_id TEXT NOT NULL,
  trashed_at INTEGER, trash_batch_id TEXT, trash_notice_at INTEGER
) STRICT;
CREATE INDEX folders_parent ON folders(parent_id);
CREATE INDEX folders_trash ON folders(trash_batch_id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES folders(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  head_version_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, device_id TEXT NOT NULL,
  trashed_at INTEGER, trash_batch_id TEXT, trash_notice_at INTEGER
) STRICT;
CREATE INDEX notes_folder ON notes(folder_id);
CREATE INDEX notes_updated ON notes(updated_at);
CREATE INDEX notes_trash ON notes(trash_batch_id);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, device_id TEXT NOT NULL
) STRICT;

CREATE TABLE note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, tag_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX note_tags_tag ON note_tags(tag_id);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN
    ('edit','size','agent','remote','merge_base','restore','pre_restore','recovered')),
  parent_version_id TEXT,
  created_at INTEGER NOT NULL, device_id TEXT NOT NULL, actor_id TEXT
) STRICT;
CREATE INDEX versions_note ON versions(note_id, created_at);

CREATE TABLE base_holds (
  peer_id TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (peer_id, version_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE drafts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  base_rev INTEGER NOT NULL,
  base_content_hash TEXT NOT NULL,
  saved_at INTEGER NOT NULL
) STRICT;
CREATE INDEX drafts_note ON drafts(note_id, seq);

CREATE TABLE tombstones (
  entity_id TEXT PRIMARY KEY,
  entity TEXT,
  purged_at INTEGER NOT NULL,
  change_id TEXT NOT NULL,
  merged_into TEXT
) STRICT;

CREATE TABLE change_log (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL CHECK (entity IN ('note','folder','tag','note_tag','attachment_ref','setting')),
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('create','update','move','trash','restore','purge')),
  hlc TEXT NOT NULL,
  device_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  origin TEXT NOT NULL CHECK (origin IN ('local','remote')),
  actor_id TEXT,
  schema_version INTEGER NOT NULL,
  fields TEXT CHECK (fields IS NULL OR json_valid(fields)),
  note_version_id TEXT,
  base_version_id TEXT,
  content_hash TEXT,
  base_content_hash TEXT,
  purged_ids TEXT CHECK (purged_ids IS NULL OR json_valid(purged_ids)),
  merged_into TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX change_log_dev_seq ON change_log(device_id, seq);
CREATE INDEX change_log_entity ON change_log(entity, entity_id);
CREATE INDEX change_log_entity_id ON change_log(entity_id);
CREATE INDEX change_log_hlc ON change_log(hlc, device_id);

CREATE TRIGGER change_log_no_delete BEFORE DELETE ON change_log
BEGIN SELECT RAISE(ABORT, 'change_log is append-only'); END;

-- The only permitted UPDATE is redaction on purge: fields set to NULL, every other column unchanged.
CREATE TRIGGER change_log_redact_only BEFORE UPDATE ON change_log
WHEN NOT (NEW.fields IS NULL AND NEW.id IS OLD.id AND NEW.entity IS OLD.entity
  AND NEW.entity_id IS OLD.entity_id AND NEW.op IS OLD.op AND NEW.hlc IS OLD.hlc
  AND NEW.device_id IS OLD.device_id AND NEW.seq IS OLD.seq AND NEW.origin IS OLD.origin
  AND NEW.actor_id IS OLD.actor_id AND NEW.schema_version IS OLD.schema_version
  AND NEW.note_version_id IS OLD.note_version_id AND NEW.base_version_id IS OLD.base_version_id
  AND NEW.content_hash IS OLD.content_hash AND NEW.base_content_hash IS OLD.base_content_hash
  AND NEW.purged_ids IS OLD.purged_ids AND NEW.merged_into IS OLD.merged_into
  AND NEW.created_at IS OLD.created_at)
BEGIN SELECT RAISE(ABORT, 'change_log is append-only'); END;
`;

export default { version: 1, name: 'init', sql } satisfies Migration;
