import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROBE_TABLES } from '../../src/search/damage.ts';
import { SEARCH_FTS_SQL, SEARCH_TRIGGER_NAMES, SEARCH_TRIGGERS_SQL } from '../../src/search/ddl.ts';
import { schemaDump } from '../../src/db/migrate.ts';
import { createNotesApi } from '../../src/notes/notes.ts';
import { createTagsApi } from '../../src/tags/tags.ts';
import { MIGRATIONS, open, tmp } from '../store/helpers.ts';
import { find, ids } from '../search/util.ts';
import { closeAtt, makePdf, mkNote, openAtt, textPdf, unwrap } from './util.ts';

type Db = ReturnType<typeof openAtt>['w']['store']['db'];
const triggerNames = (db: Db): string[] =>
  (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'search_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
const columns = (db: Db, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
const state = (db: Db): string => (db.prepare("SELECT value FROM meta WHERE key = 'search_state'").get() as { value: string }).value;

describe('search DDL owned by the rebuild', () => {
  it('lists twelve triggers, the three new ones included, and every name is created by the SQL', () => {
    expect(SEARCH_TRIGGER_NAMES).toHaveLength(12);
    for (const n of ['search_na_ai', 'search_na_ad', 'search_att_au']) expect(SEARCH_TRIGGER_NAMES).toContain(n);
    for (const n of SEARCH_TRIGGER_NAMES) expect(SEARCH_TRIGGERS_SQL).toContain(`CREATE TRIGGER ${n} `);
    expect(SEARCH_TRIGGERS_SQL.match(/CREATE TRIGGER /g)).toHaveLength(12);
    expect(SEARCH_FTS_SQL).toContain('title, body, tags, att');
    expect(SEARCH_FTS_SQL).toContain('bm25(10.0, 1.0, 5.0, 0.5)');
  });

  it('a fresh workspace has the 4-column table and exactly those triggers', () => {
    const a = openAtt();
    expect(columns(a.w.store.db, 'note_fts')).toEqual(['title', 'body', 'tags', 'att']);
    expect(triggerNames(a.w.store.db)).toEqual([...SEARCH_TRIGGER_NAMES].sort());
    expect(state(a.w.store.db)).toBe('ok'); // an empty workspace is ready at once
  });

  it('PROBE_TABLES covers the two attachment tables the new triggers read', () => {
    expect(PROBE_TABLES).toContain('attachments');
    expect(PROBE_TABLES).toContain('note_attachments');
  });

  it('quarantine drops all twelve triggers; the rebuild brings them back', () => {
    const a = openAtt();
    mkNote(a.w, 'x', 'alpha');
    unwrap(a.w.search.markDirty('test'));
    expect(triggerNames(a.w.store.db)).toEqual([]);
    unwrap(a.w.search.rebuild());
    expect(triggerNames(a.w.store.db)).toEqual([...SEARCH_TRIGGER_NAMES].sort());
  });
});

describe('migration 0003 from a v2 database with notes', () => {
  function makeV2() {
    const dir = tmp();
    const p = join(dir, 'w.db');
    const v2 = open(p, { migrations: [MIGRATIONS[0]!, MIGRATIONS[1]!] });
    const notes = createNotesApi(v2);
    const tags = createTagsApi(v2);
    const made = ['apple pie', 'banana split', 'cherry tart'].map(
      (t) => unwrap(notes.create({}, { title: t, body: `${t} recipe` })).id,
    );
    const tag = unwrap(tags.create({}, 'dessert')).id;
    unwrap(tags.tagNote({}, made[0]!, tag));
    unwrap(v2.close());
    return { dir, p, made };
  }

  it('adds only tables and columns, drops the old triggers, marks the index dirty, and backfills nothing', () => {
    const { dir, made } = makeV2();
    const a = openAtt({ dir });
    const db = a.w.store.db;
    expect(state(db)).toBe('dirty');
    expect((db.prepare("SELECT value FROM meta WHERE key = 'search_dirty_reason'").get() as { value: string }).value).toBe('migration 0003');
    expect(columns(db, 'attachments')).toEqual(['sha256', 'size', 'mime', 'kind', 'text', 'text_state', 'verify_state', 'verified_at', 'created_at']);
    expect(columns(db, 'note_attachments')).toEqual(['id', 'note_id', 'sha256', 'name', 'created_at', 'device_id']);
    expect(columns(db, 'search_doc')).toContain('att');
    expect(columns(db, 'search_stash')).toContain('att');
    expect(columns(db, 'search_src')).toContain('att');
    expect(triggerNames(db)).toEqual([]);
    // the FTS table itself was NOT touched by the migration (the rebuild owns it)
    expect(columns(db, 'note_fts')).toEqual(['title', 'body', 'tags']);
    expect(db.prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM note_attachments').get()).toEqual({ n: 0 });
    // notes and tags survive
    expect(db.prepare('SELECT count(*) AS n FROM notes').get()).toEqual({ n: made.length });
    // a pre-migration backup was taken
    expect(readdirSync(join(dir, 'backups')).some((f) => /^pre-migration-v2-.*\.sqlite$/.test(f))).toBe(true);
  });

  it('the rebuild creates the 4-column table and all triggers, search works, and the schema equals a fresh one', () => {
    const { dir, made } = makeV2();
    const a = openAtt({ dir });
    expect(unwrap(a.w.search.status())).toEqual({ state: 'dirty' });
    unwrap(a.w.search.rebuild());
    const db = a.w.store.db;
    expect(columns(db, 'note_fts')).toEqual(['title', 'body', 'tags', 'att']);
    expect(triggerNames(db)).toEqual([...SEARCH_TRIGGER_NAMES].sort());
    expect(ids(find(a.w, 'banana'))).toEqual([made[1]]);
    expect(ids(find(a.w, 'dessert'))).toEqual([made[0]]);
    const fresh = openAtt();
    expect(schemaDump(db)).toBe(schemaDump(fresh.w.store.db));
    expect(unwrap(a.w.search.verify()).ok).toBe(true);
  });

  it('writes made before the rebuild finishes do not break (the triggers are gone until it starts)', () => {
    const { dir } = makeV2();
    const a = openAtt({ dir });
    const n = mkNote(a.w, 'during', 'between migration and rebuild');
    unwrap(a.w.search.rebuild());
    expect(ids(find(a.w, 'between'))).toEqual([n]);
  });

  it('a damaged fts5 config row cannot lock the user out of the upgrade', () => {
    const { dir, p, made } = makeV2();
    const raw = new Database(p) as InstanceType<typeof Database> & { unsafeMode(on: boolean): void };
    raw.unsafeMode(true);
    raw.exec("DELETE FROM note_fts_config WHERE k = 'version'");
    raw.close();
    const a = openAtt({ dir }); // default guards: the startup check quarantines, the migration still runs
    expect(columns(a.w.store.db, 'attachments').length).toBeGreaterThan(0);
    expect(state(a.w.store.db)).toBe('dirty');
    unwrap(a.w.search.rebuild());
    expect(ids(find(a.w, 'cherry'))).toEqual([made[2]]);
  });
});

describe('damage path with attachment triggers', () => {
  it('a damaged index does not block adding a reference; the write retry quarantines and a rebuild restores the hit', async () => {
    const pdf = textPdf('quartz fossil');
    const a = openAtt({ pdf });
    const n1 = mkNote(a.w, 'one');
    const n2 = mkNote(a.w, 'two');
    unwrap(await a.w.attachments.addFromBytes({}, n1, makePdf('x'), 'a.pdf'));
    await a.w.attachments.extractPending();
    expect(ids(find(a.w, 'quartz'))).toEqual([n1]);
    a.w.store.db.pragma('wal_checkpoint(TRUNCATE)');
    closeAtt(a);
    const raw = new Database(a.path) as InstanceType<typeof Database> & { unsafeMode(on: boolean): void };
    raw.unsafeMode(true);
    raw.exec('UPDATE note_fts_data SET block = zeroblob(length(block)) WHERE id = 10');
    raw.close();
    const b = openAtt({ dir: a.dir, pdf });
    // adding the same PDF to n2 copies its text into n2's document: the trigger must touch the damaged index
    const r = await b.w.attachments.addFromBytes({}, n2, makePdf('x'), 'b.pdf');
    expect(r.ok).toBe(true);
    expect(state(b.w.store.db)).toBe('dirty');
    expect(triggerNames(b.w.store.db)).toEqual([]);
    unwrap(b.w.search.rebuild());
    expect(new Set(ids(find(b.w, 'quartz')))).toEqual(new Set([n1, n2]));
  });
});

describe('attachment text in the index stays exact under random operations', () => {
  const WORDS = ['alder', 'birch', 'cedar', 'dogwood', 'elm', 'fir', 'gum', 'hazel'];
  const lcg = (seed: number) => {
    let s = seed >>> 0;
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  };

  it.each([1, 2, 3])('seed %i: search == brute force over title, body and the text of referenced blobs', (seed) => {
    const a = openAtt();
    const db = a.w.store.db;
    const rnd = lcg(seed);
    const pick = <T>(l: T[]): T | undefined => l[Math.floor(rnd() * l.length)];
    const phrase = (): string => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => WORDS[Math.floor(rnd() * WORDS.length)]!).join(' ');

    const notes = new Map<string, { title: string; body: string }>();
    const blobs: { sha: string; text: string }[] = [];
    const refs = new Map<string, { noteId: string; sha: string }>();
    let seq = 0;

    const attOf = (noteId: string): string[] =>
      [...refs.values()].filter((r) => r.noteId === noteId).flatMap((r) => blobs.find((b) => b.sha === r.sha)!.text.split(' '));
    const verdict = (): string | undefined => {
      for (const w of WORDS) {
        const want = [...notes.entries()]
          .filter(([id, n]) => `${n.title} ${n.body}`.split(' ').includes(w) || attOf(id).includes(w))
          .map(([id]) => id)
          .sort();
        const got = ids(find(a.w, w, { limit: 100 })).sort();
        if (JSON.stringify(got) !== JSON.stringify(want)) return `word ${w}: got ${got.length} want ${want.length}`;
      }
      return unwrap(a.w.search.verify()).ok ? undefined : 'verify failed';
    };

    for (let step = 0; step < 250; step++) {
      const op = Math.floor(rnd() * 8);
      if (op === 0 || notes.size < 2) {
        const title = `n${seq++} ${phrase()}`;
        const body = phrase();
        notes.set(unwrap(a.w.notes.create({}, { title, body })).id, { title, body });
      } else if (op === 1 && blobs.length < 6) {
        const sha = createHash('sha256').update(`blob${seq++}`).digest('hex');
        db.prepare("INSERT INTO attachments(sha256, size, mime, kind, created_at) VALUES (?, 1, 'application/pdf', 'pdf', 1)").run(sha);
        blobs.push({ sha, text: '' });
      } else if (op === 2) {
        const noteId = pick([...notes.keys()]);
        const blob = pick(blobs);
        if (noteId && blob && ![...refs.values()].some((r) => r.noteId === noteId && r.sha === blob.sha)) {
          const id = `ref${seq++}`;
          db.prepare("INSERT INTO note_attachments(id, note_id, sha256, name, created_at, device_id) VALUES (?, ?, ?, 'f', 1, 'D')").run(id, noteId, blob.sha);
          refs.set(id, { noteId, sha: blob.sha });
        }
      } else if (op === 3) {
        const id = pick([...refs.keys()]);
        if (id) {
          db.prepare('DELETE FROM note_attachments WHERE id = ?').run(id);
          refs.delete(id);
        }
      } else if (op === 4) {
        const blob = pick(blobs);
        if (blob) {
          blob.text = rnd() < 0.2 ? '' : phrase();
          db.prepare('UPDATE attachments SET text = ? WHERE sha256 = ?').run(blob.text, blob.sha);
        }
      } else if (op === 5) {
        const id = pick([...notes.keys()]);
        if (id) {
          const body = phrase();
          unwrap(a.w.notes.update({}, id, { body }));
          notes.get(id)!.body = body;
        }
      } else if (op === 6 && notes.size > 3) {
        const id = pick([...notes.keys()])!;
        unwrap(a.w.trash.trashNote({}, id));
        const batch = unwrap(a.w.trash.list()).find((i) => i.id === id)!.batchId;
        unwrap(a.w.trash.purgeBatch({}, batch, { confirmed: true }));
        notes.delete(id);
        for (const [rid, r] of [...refs]) if (r.noteId === id) refs.delete(rid);
      } else if (op === 7 && step % 25 === 0) {
        unwrap(a.w.search.rebuild()); // a rebuild mid-way must agree with the triggers
      }
      const bad = verdict();
      if (bad) throw new Error(`seed ${seed} step ${step} op ${op}: ${bad}`); // reported by vitest; no expect() in a callback
    }
    expect(notes.size).toBeGreaterThan(1);
  }, 120_000);
});
