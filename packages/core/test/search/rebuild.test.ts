import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createSearchApi } from '../../src/search/index.ts';
import { openStore } from '../../src/store/store.ts';
import { createNotesApi } from '../../src/notes/notes.ts';
import { MIGRATIONS, open, tmp } from '../store/helpers.ts';
import { schemaDump } from '../../src/db/migrate.ts';
import { join } from 'node:path';
import { closeWs, find, ids, mkNote, openWs, unwrap } from './util.ts';

const state = (x: Pick<ReturnType<typeof openWs>, 'w'>) =>
  x.w.store.db.prepare("SELECT value FROM meta WHERE key = 'search_state'").get() as {
    value: string;
  };

describe('SR-9 chunked rebuild', () => {
  it('rebuilds in slices with progress; queries answer rebuilding; concurrent writes are caught up', () => {
    const { w } = openWs();
    const api = createSearchApi(w.store, { sliceSize: 3 });
    const all = Array.from({ length: 10 }, (_, i) => mkNote(w, `note ${i}`, `common word${i}`));
    unwrap(api.markDirty('test'));
    expect(unwrap(api.status())).toEqual({ state: 'dirty' });
    const during = unwrap(api.search({ query: 'common' }));
    expect(during).toMatchObject({ state: 'rebuilding', hits: [] });
    expect(during.messages.join(' ')).toMatch(/rebuilt/);

    const s1 = unwrap(api.rebuildStep());
    expect(s1).toMatchObject({ done: false, processed: 3, total: 10 });
    expect(unwrap(api.status())).toEqual({ state: 'rebuilding', progress: { done: 3, total: 10 } });
    // Writes between slices: an indexed note, a not-yet-indexed note, a new note, a purge, a tag.
    unwrap(w.notes.update({}, all[0]!, { body: 'common edited-early' }));
    unwrap(w.notes.update({}, all[9]!, { body: 'common edited-late' }));
    const fresh = mkNote(w, 'brand new', 'common arrived-during');
    const batch = unwrap(w.trash.trashNote({}, all[1]!)).batchId;
    unwrap(w.trash.purgeBatch({}, batch, { confirmed: true }));
    const tag = unwrap(w.tags.create({}, 'during')).id;
    unwrap(w.tags.tagNote({}, all[2]!, tag));
    unwrap(w.tags.tagNote({}, all[8]!, tag));
    let steps = 1;
    for (;;) {
      const r = unwrap(api.rebuildStep());
      steps++;
      if (r.done) break;
      expect(steps).toBeLessThan(20);
    }
    expect(unwrap(api.status())).toEqual({ state: 'ready' });
    expect(unwrap(api.verify()).ok).toBe(true);
    const found = (q: string) => ids(unwrap(api.search({ query: q })) as never).sort();
    expect(found('common')).toEqual([...all.filter((n) => n !== all[1]), fresh].sort());
    expect(found('edited-early')).toEqual([all[0]]);
    expect(found('edited-late')).toEqual([all[9]]);
    expect(found('arrived-during')).toEqual([fresh]);
    expect(found('tag:during').sort()).toEqual([all[2], all[8]].sort());
    expect(found('word1')).toEqual([]); // purged
  });

  it('rebuild() reaches ready and keeps rank weights and secure-delete OFF (M5)', () => {
    const { w } = openWs();
    for (let i = 0; i < 5; i++) mkNote(w, `n${i}`, 'alpha');
    unwrap(w.search.rebuild());
    expect(unwrap(w.search.status())).toEqual({ state: 'ready' });
    const cfg = Object.fromEntries(
      (
        w.store.db.prepare('SELECT k, v FROM note_fts_config').all() as { k: string; v: unknown }[]
      ).map((r) => [r.k, r.v]),
    );
    expect(cfg['rank']).toBe('bm25(10.0, 1.0, 5.0, 0.5)');
    expect(cfg['secure-delete']).toBe(0);
    expect(ids(find(w, 'alpha'))).toHaveLength(5);
  });

  it('a dirty flag, a missing search_doc row, or a half-done rebuild is picked up after reopen', () => {
    const a = openWs();
    const n = [mkNote(a.w, 'one', 'kumquat'), mkNote(a.w, 'two', 'kumquat')];
    // (1) missing doc row => count mismatch
    a.w.store.db.prepare('DELETE FROM search_doc WHERE note_id = ?').run(n[0]);
    closeWs(a);
    const b = openWs({ path: a.path });
    expect(unwrap(b.w.search.status())).toEqual({ state: 'dirty' });
    unwrap(b.w.search.rebuild());
    expect(ids(find(b.w, 'kumquat')).sort()).toEqual([...n].sort());
    // (2) dirty flag
    unwrap(b.w.search.markDirty('test'));
    closeWs(b);
    const c = openWs({ path: a.path });
    expect(unwrap(c.w.search.status())).toEqual({ state: 'dirty' });
    // (3) half-done rebuild resumes
    const api = createSearchApi(c.w.store, { sliceSize: 1 });
    unwrap(api.rebuildStep());
    closeWs(c);
    const d = openWs({ path: a.path });
    expect(unwrap(d.w.search.status())).toMatchObject({ state: 'rebuilding' });
    while (!unwrap(d.w.search.rebuildStep()).done);
    expect(unwrap(d.w.search.status())).toEqual({ state: 'ready' });
    expect(ids(find(d.w, 'kumquat')).sort()).toEqual([...n].sort());
    expect(state(d).value).toBe('ok');
  });
});

describe('verify while the index is not ready', () => {
  it('reports skipped, not a problem, and does not disturb the rebuild', () => {
    const { w } = openWs();
    mkNote(w, 'a', 'alpha');
    unwrap(w.search.markDirty('test'));
    expect(unwrap(w.search.verify())).toEqual({ ok: true, skipped: true });
    expect(unwrap(w.search.status())).toEqual({ state: 'dirty' });
    unwrap(w.search.rebuild());
    expect(unwrap(w.search.verify())).toEqual({ ok: true });
  });
});

describe('upgrade from a v1 database that has notes (CS-1)', () => {
  it('migrates schema-only, marks the index dirty, backfills by rebuild, and equals a fresh schema', () => {
    const p = join(tmp(), 'w.db');
    const v1 = open(p, { migrations: [MIGRATIONS[0]!] });
    const notes = createNotesApi(v1);
    const made = ['apple pie', 'banana split'].map(
      (t) => unwrap(notes.create({}, { title: t, body: `${t} body` })).id,
    );
    unwrap(v1.close());
    const { w } = openWs({ path: p });
    expect(state({ w }).value).toBe('dirty');
    expect(unwrap(w.search.status())).toEqual({ state: 'dirty' });
    unwrap(w.search.rebuild());
    expect(ids(find(w, 'banana'))).toEqual([made[1]]);
    const fresh = openWs();
    expect(schemaDump(w.store.db)).toBe(schemaDump(fresh.w.store.db));
    expect(state(fresh).value).toBe('ok'); // an empty database starts with a trusted index
  });

  it('opens a fresh store through openStore too', () => {
    const r = openStore(join(tmp(), 'x.db'), { guards: [] });
    expect(r.ok).toBe(true);
    if (r.ok) r.value.close();
  });
});

describe('M5 on the drop-path (unsafeMode) rebuild', () => {
  it('a dropped fts5 config row is repaired and rank + secure-delete are re-read from the NEW index', () => {
    const a = openWs();
    for (let i = 0; i < 6; i++) mkNote(a.w, `n${i}`, 'alpha');
    closeWs(a);
    const raw = new Database(a.path) as InstanceType<typeof Database> & {
      unsafeMode(on: boolean): void;
    };
    raw.unsafeMode(true);
    raw.exec("DELETE FROM note_fts_config WHERE k = 'version'"); // DROP TABLE cannot run until repaired
    raw.close();
    const b = openWs({ path: a.path });
    expect(unwrap(b.w.search.status())).toEqual({ state: 'dirty' });
    unwrap(b.w.search.rebuild());
    const cfg = Object.fromEntries(
      (
        b.w.store.db.prepare('SELECT k, v FROM note_fts_config').all() as {
          k: string;
          v: unknown;
        }[]
      ).map((r) => [r.k, r.v]),
    );
    expect(cfg['rank']).toBe('bm25(10.0, 1.0, 5.0, 0.5)');
    expect(cfg['secure-delete']).toBe(0);
    expect(cfg['version']).toBeDefined();
    expect(ids(find(b.w, 'alpha'))).toHaveLength(6);
    expect(unwrap(b.w.search.verify()).ok).toBe(true);
  });
});
