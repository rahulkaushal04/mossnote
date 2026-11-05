import { readFileSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openWorkspace } from '../../src/workspace.ts';
import { closeWs, find, ids, mkNote, openWs, unwrap, type Ws } from './util.ts';

/**
 * BLOCKER 1 / MAJOR 1 / MAJOR 7: what counts as damage confined to the rebuildable search tables, and
 * what must stay real corruption. File-level damage is applied to a closed database.
 */

type Raw = InstanceType<typeof Database> & { unsafeMode(on: boolean): void };
function sql(path: string, stmt: string, writable = false): void {
  const db = new Database(path) as unknown as Raw;
  db.unsafeMode(true);
  if (writable) db.pragma('writable_schema = ON');
  db.exec(stmt);
  db.close();
}
const rootOf = (path: string, name: string): number => {
  const db = new Database(path);
  try {
    return (
      db.prepare('SELECT rootpage AS r FROM sqlite_schema WHERE name = ?').get(name) as {
        r: number;
      }
    ).r;
  } finally {
    db.close();
  }
};
function editFile(path: string, f: (b: Buffer, pageSize: number) => void): void {
  const b = readFileSync(path);
  f(b, b.readUInt16BE(16) || 65536);
  writeFileSync(path, b);
}
/** Ruins one b-tree page (cell pointers and content) of the named table or index. */
function fillPage(path: string, name: string): void {
  const root = rootOf(path, name);
  editFile(path, (b, ps) => b.fill(0xff, (root - 1) * ps + 20, root * ps));
}
/** Makes the first freelist trunk page claim an impossible number of leaves. */
function breakFreelist(path: string): void {
  editFile(path, (b, ps) => b.writeUInt32BE(0xfffffff, (b.readUInt32BE(32) - 1) * ps + 4));
}

/** 40 notes, and a freelist (a dropped scratch table) so freelist damage has something to hit. */
function seeded(): { a: Ws; notes: string[] } {
  const a = openWs();
  const notes = Array.from({ length: 40 }, (_, i) =>
    mkNote(a.w, `seed ${i}`, `quartz ${i} ${'filler '.repeat(60)}`),
  );
  a.w.store.db.exec(
    'CREATE TABLE junk(a); INSERT INTO junk SELECT randomblob(900) FROM notes, notes LIMIT 2000; DROP TABLE junk;',
  );
  return { a, notes };
}
const stateOf = (w: Ws['w']): string =>
  (
    w.store.db.prepare("SELECT value FROM meta WHERE key = 'search_state'").get() as {
      value: string;
    }
  ).value;
const triggers = (w: Ws['w']): number =>
  (
    w.store.db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'search_%'",
      )
      .get() as { n: number }
  ).n;

describe('BLOCKER 1: page-level and page-accounting damage is real corruption', () => {
  const MODES: Record<string, (path: string) => void> = {
    'a corrupt freelist trunk page': breakFreelist,
    'a note_fts_data page pointer aimed at the notes root (cross-linked page)': (p) =>
      sql(
        p,
        `UPDATE sqlite_schema SET rootpage = ${rootOf(p, 'notes')} WHERE name = 'note_fts_data'`,
        true,
      ),
    'a ruined page inside a shadow table': (p) => fillPage(p, 'note_fts_data'),
    'a ruined page inside the content_rowid table (search_doc)': (p) => fillPage(p, 'search_doc'),
    'a corrupt freelist hidden behind a dropped fts5 config row': (p) => {
      sql(p, "DELETE FROM note_fts_config WHERE k = 'version'");
      breakFreelist(p);
    },
  };
  it.each(Object.keys(MODES))('%s => recovery mode (corrupt), never "index only"', (mode) => {
    const { a } = seeded();
    closeWs(a);
    MODES[mode]!(a.path);
    const r = openWorkspace(a.path, { clock: { now: () => 1 } }); // DEFAULT guards
    expect(r).toMatchObject({ ok: false, error: { code: 'corrupt' } });
  });

  it('the rebuild refuses to run when the base tables fail a full quick_check, and nothing is dropped', () => {
    const { a, notes } = seeded();
    unwrap(a.w.search.markDirty('test'));
    closeWs(a);
    breakFreelist(a.path);
    const b = openWs({ path: a.path, guards: [] }); // bypass the guard to reach the rebuild
    const r = b.w.search.rebuild();
    expect(r).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    if (!r.ok) expect(r.error.message).toMatch(/cannot be rebuilt/);
    const tables = b.w.store.db
      .prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'note_fts'")
      .get() as { n: number };
    expect(tables.n).toBe(1); // the FTS table was not dropped
    expect((b.w.store.db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n).toBe(
      notes.length,
    );
    // MAJOR 2 in core: the failure is reported as an error state, searching does not loop, and a manual request re-arms.
    expect(unwrap(b.w.search.status())).toMatchObject({ state: 'error' });
    expect(unwrap(b.w.search.search({ query: 'quartz' }))).toMatchObject({
      state: 'error',
      hits: [],
    });
    unwrap(b.w.search.requestRebuild());
    expect(unwrap(b.w.search.status())).toEqual({ state: 'dirty' });
  });
});

describe('MAJOR 1: the write retry must not hide real corruption', () => {
  it('a damaged note_tags index reached only through the tag-rename trigger => the save returns corrupt', () => {
    const a = openWs();
    const tag = unwrap(a.w.tags.create({}, 'topic')).id;
    for (let i = 0; i < 30; i++) unwrap(a.w.tags.tagNote({}, mkNote(a.w, `n${i}`, 'body'), tag));
    closeWs(a);
    fillPage(a.path, 'note_tags_tag');
    const b = openWs({ path: a.path, guards: [] });
    const r = b.w.tags.rename({}, tag, 'topic renamed');
    expect(r).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    // Not quarantined: the triggers stay and the index is still trusted (nothing was hidden by a retry).
    expect(triggers(b.w)).toBe(12);
    expect(stateOf(b.w)).toBe('ok');
    expect(
      (b.w.store.db.prepare('SELECT name FROM tags WHERE id = ?').get(tag) as { name: string })
        .name,
    ).toBe('topic');
  });

  it('index-only damage still lets the same kind of write through (control)', () => {
    const a = openWs();
    const tag = unwrap(a.w.tags.create({}, 'topic')).id;
    for (let i = 0; i < 5; i++) unwrap(a.w.tags.tagNote({}, mkNote(a.w, `n${i}`, 'body'), tag));
    closeWs(a);
    sql(a.path, 'UPDATE note_fts_data SET block = zeroblob(length(block)) WHERE id = 10');
    const b = openWs({ path: a.path });
    unwrap(b.w.tags.rename({}, tag, 'topic renamed'));
    expect(stateOf(b.w)).toBe('dirty');
    unwrap(b.w.search.rebuild());
    expect(ids(find(b.w, 'renamed')).length).toBe(5);
  });
});

describe('MAJOR 7: applyRemote has the same damage retry', () => {
  it('a remote change applies on an index-damaged workspace and the index is marked dirty', () => {
    const a = openWs();
    const seed = Array.from({ length: 10 }, (_, i) => mkNote(a.w, `seed ${i}`, `quartz ${i}`));
    closeWs(a);
    sql(a.path, 'UPDATE note_fts_data SET block = zeroblob(length(block)) WHERE id = 10');
    const b = openWs({ path: a.path }); // structure-row damage passes the guard: only writes notice
    expect(stateOf(b.w)).toBe('ok');
    const PEER = '01HF7YAT00000000000000PEER';
    const target = seed[0]!;
    const r = b.w.store.changelog.applyRemote(
      {
        id: '01HF7YAT0000000000000000A1',
        entity: 'note',
        entityId: target,
        op: 'update',
        hlc: '000001700000000-0000000007',
        deviceId: PEER,
        seq: 1,
        actorId: null,
        schemaVersion: 2,
        fields: { title: 'remote title' },
        contentHash: 'h',
        createdAt: 1,
      },
      () => {
        b.w.store.db
          .prepare("UPDATE notes SET title = 'remote title', body = 'remote body' WHERE id = ?")
          .run(target);
        return { ok: true, value: undefined };
      },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(
      (
        b.w.store.db.prepare('SELECT title FROM notes WHERE id = ?').get(target) as {
          title: string;
        }
      ).title,
    ).toBe('remote title');
    expect(stateOf(b.w)).toBe('dirty');
    expect(triggers(b.w)).toBe(0);
    unwrap(b.w.search.rebuild());
    expect(ids(find(b.w, 'remote'))).toEqual([target]);
    expect(unwrap(b.w.search.verify()).ok).toBe(true);
  });
});
