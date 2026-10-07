import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { alive } from './alive';
import { openDatabase, type Database, type Sqlite } from './client';
import { notes } from './schema';
import { makeTempDir, migratedMemoryDatabase, removeDir } from '../testing/helpers';

let database: Database;
let sqlite: Sqlite;
beforeEach(async () => {
  database = await migratedMemoryDatabase();
  sqlite = database.sqlite;
});
afterEach(() => {
  sqlite.close();
});

const NOW = 1_700_000_000_000;
const insertNote = (id: string, extra: Record<string, unknown> = {}) => {
  const row = { id, body: 'text', created_at: NOW, updated_at: NOW, ...extra };
  const cols = Object.keys(row);
  sqlite
    .prepare(`INSERT INTO notes (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...Object.values(row));
};
const insertPerson = (id: string, extra: Record<string, unknown> = {}) => {
  const row = { id, name: 'Example Person', created_at: NOW, updated_at: NOW, ...extra };
  const cols = Object.keys(row);
  sqlite
    .prepare(`INSERT INTO people (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...Object.values(row));
};
const insertPlanting = (id: string, extra: Record<string, unknown> = {}) => {
  const row = { id, label: 'Example entry', created_at: NOW, updated_at: NOW, ...extra };
  const cols = Object.keys(row);
  sqlite
    .prepare(`INSERT INTO plantings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...Object.values(row));
};
const insertLink = (id: string, extra: Record<string, unknown>) => {
  const row = { id, source_note_id: 'n1', created_at: NOW, ...extra };
  const cols = Object.keys(row);
  sqlite
    .prepare(`INSERT INTO links (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...Object.values(row));
};
const count = (table: string) =>
  (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('connection pragmas', () => {
  it('sets WAL, foreign keys, synchronous NORMAL and busy_timeout on a file database', () => {
    const dir = makeTempDir();
    const file = openDatabase(path.join(dir, 'p.db'));
    expect(file.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(file.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(file.sqlite.pragma('synchronous', { simple: true })).toBe(1);
    expect(file.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    file.sqlite.close();
    removeDir(dir);
  });

  it('turns foreign keys on for in-memory databases too', () => {
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('links table', () => {
  beforeEach(() => {
    insertNote('n1');
    insertNote('n2');
    insertNote('n3');
    insertPerson('p1');
    insertPerson('p2');
    insertPlanting('f1');
  });

  it('accepts exactly one target of each kind', () => {
    insertLink('l1', { target_note_id: 'n2' });
    insertLink('l2', { target_person_id: 'p1' });
    insertLink('l3', { target_planting_id: 'f1' });
    expect(count('links')).toBe(3);
  });

  it('rejects a link with no target', () => {
    expect(() => insertLink('l1', {})).toThrow(/links_exactly_one_target/);
  });

  it('rejects a link with more than one target', () => {
    expect(() => insertLink('l1', { target_note_id: 'n2', target_person_id: 'p1' })).toThrow(
      /links_exactly_one_target/,
    );
    expect(() =>
      insertLink('l2', { target_note_id: 'n2', target_person_id: 'p1', target_planting_id: 'f1' }),
    ).toThrow(/links_exactly_one_target/);
  });

  it('rejects a note linking to itself', () => {
    expect(() => insertLink('l1', { target_note_id: 'n1' })).toThrow(/links_not_self/);
  });

  it('prevents duplicates with one partial unique index per target kind', () => {
    insertLink('a1', { target_note_id: 'n2' });
    expect(() => insertLink('a2', { target_note_id: 'n2' })).toThrow(/UNIQUE/);
    insertLink('b1', { target_person_id: 'p1' });
    expect(() => insertLink('b2', { target_person_id: 'p1' })).toThrow(/UNIQUE/);
    insertLink('c1', { target_planting_id: 'f1' });
    expect(() => insertLink('c2', { target_planting_id: 'f1' })).toThrow(/UNIQUE/);
  });

  it('allows different targets, and the same target from different notes', () => {
    insertLink('a1', { target_note_id: 'n2' });
    insertLink('a2', { target_note_id: 'n3' });
    insertLink('b1', { target_person_id: 'p1' });
    insertLink('b2', { target_person_id: 'p2' });
    insertLink('b3', { source_note_id: 'n2', target_person_id: 'p1' });
    expect(count('links')).toBe(5);
  });

  it('does not treat NULL target columns as duplicates of each other', () => {
    insertLink('a1', { target_note_id: 'n2' });
    insertLink('b1', { target_person_id: 'p1' });
    insertLink('c1', { target_planting_id: 'f1' });
    expect(count('links')).toBe(3);
  });

  it('lists the three partial unique indexes and the three target indexes', () => {
    const indexes = sqlite
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'links'")
      .all() as { name: string; sql: string | null }[];
    const unique = indexes.filter((i) => i.sql?.includes('UNIQUE'));
    expect(unique.map((i) => i.name).sort()).toEqual([
      'links_note_unique',
      'links_person_unique',
      'links_planting_unique',
    ]);
    for (const index of unique) expect(index.sql).toMatch(/WHERE/);
    expect(indexes.map((i) => i.name)).toEqual(
      expect.arrayContaining([
        'links_target_note_idx',
        'links_target_person_idx',
        'links_target_planting_idx',
      ]),
    );
  });

  it('cascades when a hard-deleted target or source goes away', () => {
    insertLink('a1', { target_note_id: 'n2' });
    insertLink('b1', { target_person_id: 'p1' });
    insertLink('c1', { target_planting_id: 'f1' });
    sqlite.prepare("DELETE FROM people WHERE id = 'p1'").run();
    sqlite.prepare("DELETE FROM plantings WHERE id = 'f1'").run();
    expect(count('links')).toBe(1);
    sqlite.prepare("DELETE FROM notes WHERE id = 'n1'").run();
    expect(count('links')).toBe(0);
  });

  it('rejects a link to a record that does not exist', () => {
    expect(() => insertLink('x', { target_person_id: 'missing' })).toThrow(/FOREIGN KEY/);
  });
});

describe('notes constraints', () => {
  it('requires a title or a non-space body', () => {
    expect(() => insertNote('a', { body: '   ' })).toThrow(/notes_has_content/);
    expect(() => insertNote('b', { body: '', title: '  ' })).toThrow(/notes_has_content/);
    insertNote('c', { body: '', title: 'Only a title' });
    insertNote('d', { body: 'Only a body' });
  });

  it('limits the question state values', () => {
    expect(() => insertNote('a', { question_state: 'maybe' })).toThrow(
      /notes_question_state_valid/,
    );
    insertNote('b', { question_state: 'open' });
    insertNote('c', { question_state: 'solved', solved_at: NOW, solved_game_date: 10_001 });
  });

  it('allows a resolution only with a question, and solved fields only when solved', () => {
    expect(() => insertNote('a', { resolution: 'x' })).toThrow(/notes_resolution_needs_question/);
    expect(() => insertNote('b', { question_state: 'open', solved_at: NOW })).toThrow(
      /notes_solved_fields_need_solved/,
    );
    expect(() => insertNote('c', { question_state: 'open', solved_game_date: 10_001 })).toThrow(
      /notes_solved_fields_need_solved/,
    );
    insertNote('d', { question_state: 'open', resolution: 'kept after reopening' });
  });

  it('limits lengths and boolean values', () => {
    expect(() => insertNote('a', { body: 'x'.repeat(50_001) })).toThrow(/notes_body_length/);
    insertNote('b', { body: 'x'.repeat(50_000) });
    expect(() => insertNote('c', { title: 'x'.repeat(201) })).toThrow(/notes_title_length/);
    expect(() => insertNote('d', { is_discovery: 2 })).toThrow(/notes_is_discovery_bool/);
  });
});

describe('people and plantings constraints', () => {
  it('requires a name and keeps progress within the maximum', () => {
    expect(() => insertPerson('a', { name: '' })).toThrow(/people_name_valid/);
    expect(() => insertPerson('b', { name: '   ' })).toThrow(/people_name_valid/);
    expect(() => insertPerson('c', { name: 'x'.repeat(81) })).toThrow(/people_name_valid/);
    expect(() => insertPerson('d', { progress: 1 })).toThrow(/people_progress_valid/);
    expect(() => insertPerson('e', { progress: 4, progress_max: 3 })).toThrow(
      /people_progress_valid/,
    );
    expect(() => insertPerson('f', { progress: -1, progress_max: 3 })).toThrow(
      /people_progress_valid/,
    );
    expect(() => insertPerson('g', { progress_max: 100 })).toThrow(/people_progress_max_range/);
    expect(() => insertPerson('h', { progress_max: 0 })).toThrow(/people_progress_max_range/);
    insertPerson('i', { progress: 0, progress_max: 3 });
    insertPerson('j', { progress: 3, progress_max: 3 });
    insertPerson('k', { progress_max: 5 });
  });

  it('keeps farm dates ordered and counts in range', () => {
    expect(() => insertPlanting('a', { planted_on: 10_005, harvested_on: 10_004 })).toThrow(
      /plantings_harvest_not_before_planting/,
    );
    insertPlanting('b', { planted_on: 10_005, harvested_on: 10_005 });
    insertPlanting('c', { harvested_on: 10_001 });
    insertPlanting('d', { planted_on: 10_001 });
    expect(() => insertPlanting('e', { planted_count: -1 })).toThrow(
      /plantings_planted_count_range/,
    );
    expect(() => insertPlanting('f', { harvested_count: 1_000_000 })).toThrow(
      /plantings_harvested_count_range/,
    );
    expect(() => insertPlanting('g', { label: '' })).toThrow(/plantings_label_valid/);
  });
});

describe('tags and join tables', () => {
  it('keeps the lowercase key unique', () => {
    const add = (id: string, name: string, key: string) =>
      sqlite
        .prepare('INSERT INTO tags (id, name, name_key, pinned, created_at) VALUES (?, ?, ?, 0, ?)')
        .run(id, name, key, NOW);
    add('t1', 'Idea', 'idea');
    expect(() => add('t2', 'idea', 'idea')).toThrow(/UNIQUE/);
  });

  it('cascades join rows from either side and prevents duplicates', () => {
    insertNote('n1');
    sqlite
      .prepare(
        "INSERT INTO tags (id, name, name_key, pinned, created_at) VALUES ('t1', 'a', 'a', 0, 1)",
      )
      .run();
    sqlite.prepare("INSERT INTO note_tags (note_id, tag_id) VALUES ('n1', 't1')").run();
    expect(() =>
      sqlite.prepare("INSERT INTO note_tags (note_id, tag_id) VALUES ('n1', 't1')").run(),
    ).toThrow(/UNIQUE|PRIMARY/);
    sqlite.prepare("DELETE FROM tags WHERE id = 't1'").run();
    expect(count('note_tags')).toBe(0);
    expect(count('notes')).toBe(1);
  });
});

describe('alive()', () => {
  it('keeps soft-deleted rows out of reads', () => {
    insertNote('live');
    insertNote('gone', { deleted_at: NOW });
    const rows = database.db.select().from(notes).where(alive(notes)).all();
    expect(rows.map((r) => r.id)).toEqual(['live']);
    const all = database.db.select().from(notes).all();
    expect(all).toHaveLength(2);
    expect(database.db.select().from(notes).where(eq(notes.id, 'gone')).get()?.deletedAt).toEqual(
      new Date(NOW),
    );
  });
});
