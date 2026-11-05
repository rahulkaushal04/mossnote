import { readFileSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openWorkspace } from '../../src/workspace.ts';
import { closeWs, find, ids, mkNote, openWs, unwrap } from './util.ts';

type Raw = InstanceType<typeof Database> & { unsafeMode(on: boolean): void };
/** Shadow tables are write-protected; damage tests need unsafeMode. */
function damage(path: string, sql: string): void {
  const db = new Database(path) as unknown as Raw;
  db.unsafeMode(true);
  db.exec(sql);
  db.close();
}

const MODES: Record<string, string> = {
  'structure row zeroed': 'UPDATE note_fts_data SET block = zeroblob(length(block)) WHERE id = 10',
  '_idx rows deleted': 'DELETE FROM note_fts_idx',
  '_docsize rows deleted': 'DELETE FROM note_fts_docsize',
  '_config row dropped': "DELETE FROM note_fts_config WHERE k = 'version'",
  'segment blocks randomized':
    'UPDATE note_fts_data SET block = randomblob(length(block)) WHERE id > 10',
};

/** Where each mode is caught: the startup guard, the retry in mutate, or only the deep check. */
const CAUGHT_BY: Record<string, 'startup' | 'write' | 'verify'> = {
  'structure row zeroed': 'write',
  '_idx rows deleted': 'verify',
  '_docsize rows deleted': 'verify',
  '_config row dropped': 'startup',
  'segment blocks randomized': 'startup',
};
const stateOf = (w: { store: { db: { prepare(s: string): { get(): unknown } } } }) =>
  (
    w.store.db.prepare("SELECT value FROM meta WHERE key = 'search_state'").get() as {
      value: string;
    }
  ).value;

describe('damaged search index never blocks the workspace (C1, C2)', () => {
  it.each(Object.keys(MODES))(
    '%s: opens with default guards, saves succeed, rebuild restores search',
    (mode) => {
      const a = openWs();
      const seed = Array.from({ length: 20 }, (_, i) =>
        mkNote(a.w, `seed ${i}`, `quartz ${i} filler text`),
      );
      closeWs(a);
      damage(a.path, MODES[mode]!);

      const b = openWs({ path: a.path }); // DEFAULT guards: not recovery mode
      const caught = CAUGHT_BY[mode]!;
      expect(stateOf(b.w)).toBe(caught === 'startup' ? 'dirty' : 'ok');
      // The save must go through whatever the index looks like.
      unwrap(b.w.notes.update({}, seed[0]!, { body: 'quartz rewritten' }));
      const fresh = mkNote(b.w, 'newcomer', 'quartz newcomer');
      unwrap(b.w.notes.update({}, seed[1]!, { title: 'seed one renamed' }));
      // Damage invisible to the startup check and to writes is found by the deep check.
      if (unwrap(b.w.search.status()).state === 'ready') unwrap(b.w.search.verify());
      unwrap(b.w.search.rebuild());
      expect(unwrap(b.w.search.status())).toEqual({ state: 'ready' });
      expect(unwrap(b.w.search.verify()).ok).toBe(true);
      expect(ids(find(b.w, 'quartz')).sort()).toEqual([...seed, fresh].sort());
      expect(ids(find(b.w, 'rewritten'))).toEqual([seed[0]]);
      expect(ids(find(b.w, 'renamed'))).toEqual([seed[1]]);
    },
  );
});

describe('damage found while running', () => {
  it('a query that hits corrupt index blocks marks the index dirty and replies rebuilding', () => {
    const a = openWs();
    for (let i = 0; i < 20; i++) mkNote(a.w, `n${i}`, `quartz ${i}`);
    expect(find(a.w, 'quartz').hits.length).toBe(20);
    a.w.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    damage(a.path, 'UPDATE note_fts_data SET block = randomblob(length(block)) WHERE id > 10');
    const r = unwrap(a.w.search.search({ query: 'quartz' }));
    expect(r).toMatchObject({ state: 'rebuilding', hits: [] });
    expect(r.messages.join(' ')).toMatch(/damaged/);
    expect(stateOf(a.w)).toBe('dirty');
    unwrap(a.w.search.rebuild());
    expect(find(a.w, 'quartz').hits.length).toBe(20);
  });

  it('real corruption in notes is NOT treated as index damage (recovery mode as before)', () => {
    const a = openWs();
    for (let i = 0; i < 30; i++) mkNote(a.w, `n${i}`, `body ${'x'.repeat(200)} ${i}`);
    closeWs(a);
    const fd = new Database(a.path);
    const root = (
      fd.prepare("SELECT rootpage AS r FROM sqlite_schema WHERE name = 'notes'").get() as {
        r: number;
      }
    ).r;
    fd.close();
    const buf = readFileSync(a.path);
    buf.fill(0xff, (root - 1) * 4096 + 100, root * 4096);
    writeFileSync(a.path, buf);
    const r = openWorkspace(a.path, { clock: { now: () => 1 } });
    expect(r).toMatchObject({ ok: false, error: { code: 'corrupt' } });
  });
});

describe('M4: only index trouble marks the index dirty', () => {
  it('a genuine primary-key conflict fails as before and leaves triggers and state alone', () => {
    const a = openWs();
    const id = mkNote(a.w, 'dup', 'body');
    const dup = a.w.store.mutate({}, (tx) => {
      tx.db
        .prepare(
          'INSERT INTO notes(id, folder_id, title, body, content_hash, rev, favorite, created_at, updated_at, device_id) VALUES (?,NULL,?,?,?,1,0,1,1,?)',
        )
        .run(id, 't', 'b', 'h', 'D');
      return { ok: true, value: undefined };
    });
    expect(dup).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(stateOf(a.w)).toBe('ok');
    const n = (
      a.w.store.db
        .prepare(
          "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'search_%'",
        )
        .get() as { n: number }
    ).n;
    expect(n).toBe(12);
    expect(unwrap(a.w.search.verify()).ok).toBe(true);
  });

  it('INSERT OR REPLACE / OR IGNORE / UPSERT keep the index exact', () => {
    const a = openWs();
    const id = mkNote(a.w, 'old title', 'oldbody');
    const db = a.w.store.db;
    const cols =
      'id, folder_id, title, body, content_hash, rev, favorite, created_at, updated_at, device_id';
    const row = (t: string, b: string) => [id, null, t, b, 'h', 1, 0, 1, 1, 'D'];
    db.prepare(`INSERT OR REPLACE INTO notes(${cols}) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      ...row('replaced', 'repbody'),
    );
    expect(ids(find(a.w, 'oldbody'))).toEqual([]);
    expect(ids(find(a.w, 'repbody'))).toEqual([id]);
    db.prepare(`INSERT OR IGNORE INTO notes(${cols}) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      ...row('ignored', 'ignbody'),
    );
    expect(ids(find(a.w, 'repbody'))).toEqual([id]);
    db.prepare(
      `INSERT INTO notes(${cols}) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body`,
    ).run(...row('upserted', 'upbody'));
    expect(ids(find(a.w, 'upbody'))).toEqual([id]);
    expect(ids(find(a.w, 'repbody'))).toEqual([]);
    expect(unwrap(a.w.search.verify()).ok).toBe(true);
  });
});
