import { readFileSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { closeWs, find, ids, mkNote, openWs, unwrap, type Ws } from './util.ts';

const bytesOf = (p: string): Buffer =>
  Buffer.concat([
    readFileSync(p),
    existsSync(`${p}-wal`) ? readFileSync(`${p}-wal`) : Buffer.alloc(0),
  ]);

/** Term rows in the live index, through fts5vocab on a second connection. */
function vocab(path: string, term: string): number {
  const db = new Database(path);
  try {
    db.exec("CREATE VIRTUAL TABLE temp.v USING fts5vocab(main, note_fts, 'row')");
    return (
      db.prepare('SELECT count(*) AS n FROM temp.v WHERE term = ?').get(term) as { n: number }
    ).n;
  } finally {
    db.close();
  }
}

const stashRows = (a: Ws): { note_id: string; body: string }[] =>
  a.w.store.db.prepare('SELECT note_id, body FROM search_stash').all() as {
    note_id: string;
    body: string;
  }[];

/** Counts the post-purge index `optimize` statements the store issues. */
function counting(counts: { optimize: number }): (d: Db) => Db {
  return (d) =>
    new Proxy(d, {
      get(t, k) {
        const v = Reflect.get(t, k, t) as unknown;
        if (k === 'exec')
          return (s: string) => {
            if (/'optimize'/.test(s)) counts.optimize++;
            return t.exec(s);
          };
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
}

/** Seeds neighbours so the index has real structure, then the token note. */
function seed(a: Ws, token: string): string {
  for (let i = 0; i < 40; i++)
    mkNote(a.w, `filler ${i}`, `alpha beta gamma delta ${i} lorem ipsum`);
  return mkNote(a.w, 'secret', `confidential ${token} end`);
}

describe('M3 purge leaves no text behind', () => {
  const TOKEN = 'qzvxkpurgetoken';
  const SUB = 'vxkpurgeto'; // lowercase fragment: terms are stored lowercased and prefix-compressed

  it('purged note text is gone from queries, fts5vocab and the db+WAL bytes (sanity: present before)', () => {
    const a = openWs();
    const id = seed(a, TOKEN);
    a.w.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    // Sanity step: the scan can see the text before the purge, otherwise "absent" proves nothing.
    expect(bytesOf(a.path).includes(SUB)).toBe(true);
    expect(vocab(a.path, TOKEN)).toBe(1);

    const batch = unwrap(a.w.trash.trashNote({}, id)).batchId;
    unwrap(a.w.trash.purgeBatch({}, batch, { confirmed: true }));

    expect(ids(find(a.w, TOKEN))).toEqual([]); // (a) no query matches
    expect(ids(find(a.w, TOKEN, { scope: { kind: 'trash' } }))).toEqual([]);
    expect(vocab(a.path, TOKEN)).toBe(0); // (b) vocabulary
    expect(bytesOf(a.path).includes(SUB)).toBe(false); // (c) bytes of db and WAL
    expect(stashRows(a)).toEqual([]); // (d) the stash holds old text too
    expect(unwrap(a.w.search.verify()).ok).toBe(true);
    closeWs(a);
    expect(bytesOf(a.path).includes(SUB)).toBe(false);
  });

  it('a merged-away tag name leaves the index, vocab and file bytes', () => {
    const TAG = 'zqxjmergedtagname';
    const a = openWs();
    const n = seed(a, 'plain');
    const from = unwrap(a.w.tags.create({}, TAG)).id;
    const into = unwrap(a.w.tags.create({}, 'keeper')).id;
    unwrap(a.w.tags.tagNote({}, n, from));
    expect(ids(find(a.w, TAG))).toEqual([n]);
    a.w.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    expect(bytesOf(a.path).includes('xjmergedtag')).toBe(true); // sanity

    const r = unwrap(a.w.tags.rename({}, from, 'KEEPER', { confirmMerge: true }));
    expect(r.kind).toBe('merged');
    expect(ids(find(a.w, TAG))).toEqual([]);
    expect(ids(find(a.w, 'keeper'))).toEqual([n]); // membership moved
    expect(vocab(a.path, TAG)).toBe(0);
    expect(bytesOf(a.path).includes('xjmergedtag')).toBe(false);
    void into;
  });

  it('empty-trash style purgeExpired also scrubs', () => {
    const a = openWs();
    const id = seed(a, TOKEN);
    const batch = unwrap(a.w.trash.trashNote({}, id)).batchId;
    // Expire it: notice recorded, clock beyond retention.
    unwrap(a.w.trash.recordNotice([batch]));
    a.clock.t += 31 * 86_400_000;
    unwrap(a.w.trash.purgeExpired());
    expect(vocab(a.path, TOKEN)).toBe(0);
    expect(bytesOf(a.path).includes(SUB)).toBe(false);
  });

  it('purgeExpired(30) optimizes the index ONCE for the batch; a single purge still cleans up at once', () => {
    const counts = { optimize: 0 };
    const a = openWs({ wrapDb: counting(counts) });
    const batches = Array.from(
      { length: 30 },
      (_, i) =>
        unwrap(a.w.trash.trashNote({}, mkNote(a.w, `old ${i}`, `expiring text ${i}`))).batchId,
    );
    unwrap(a.w.trash.recordNotice(batches));
    a.clock.t += 31 * 86_400_000;
    counts.optimize = 0;
    const t0 = performance.now();
    const r = unwrap(a.w.trash.purgeExpired());
    const ms = performance.now() - t0;
    expect(r.batches).toHaveLength(30);
    expect(counts.optimize).toBe(1);
    expect(ms).toBeLessThan(10_000); // generous: guards against a per-item optimize + checkpoint, which is seconds at scale
    expect(ids(find(a.w, 'expiring'))).toEqual([]);
    expect(stashRows(a)).toEqual([]);
    // single purges are immediate
    const one = unwrap(a.w.trash.trashNote({}, mkNote(a.w, 'solo', 'solotext')));
    counts.optimize = 0;
    unwrap(a.w.trash.purgeBatch({}, one.batchId, { confirmed: true }));
    expect(counts.optimize).toBe(1);
  });
});

describe('MAJOR 4: search_stash does not retain note text', () => {
  const cols =
    'id, folder_id, title, body, content_hash, rev, favorite, created_at, updated_at, device_id';
  const row = (id: string, t: string, b: string) => [id, null, t, b, 'h', 1, 0, 1, 1, 'D'];

  it('is empty after UPSERT and REPLACE; an ignored insert leaves only the live note current text, which any change or delete drops', () => {
    const a = openWs();
    const id = mkNote(a.w, 'title', 'stashbody');
    const db = a.w.store.db;
    const ins = (verb: string, tail: string, t: string, b: string) =>
      db
        .prepare(`${verb} INTO notes(${cols}) VALUES (?,?,?,?,?,?,?,?,?,?) ${tail}`)
        .run(...row(id, t, b));
    expect(stashRows(a)).toEqual([]); // plain create: consumed by the AFTER INSERT trigger
    ins(
      'INSERT',
      'ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body',
      'upserted',
      'upbody',
    );
    expect(stashRows(a)).toEqual([]);
    ins('INSERT OR REPLACE', '', 'replaced', 'repbody');
    expect(stashRows(a)).toEqual([]);
    // UPSERT that changes nothing indexed still drops its stash row.
    ins('INSERT', 'ON CONFLICT(id) DO UPDATE SET rev = 2', 'replaced', 'repbody');
    expect(stashRows(a)).toEqual([]);
    // An ignored insert fires no AFTER trigger: the row left is the note's CURRENT text, never older text.
    ins('INSERT OR IGNORE', '', 'ignored', 'ignbody');
    expect(stashRows(a)).toEqual([{ note_id: id, body: 'repbody' }]);
    db.prepare('UPDATE notes SET body = ? WHERE id = ?').run('changed', id);
    expect(stashRows(a)).toEqual([]);
    ins('INSERT OR IGNORE', '', 'ignored', 'ignbody');
    expect(stashRows(a)).toHaveLength(1);
    db.prepare('DELETE FROM notes WHERE id = ?').run(id); // a delete drops it (BEFORE DELETE trigger)
    expect(stashRows(a)).toEqual([]);
    expect(unwrap(a.w.search.verify()).ok).toBe(true);
  });

  it('a purge empties the stash completely', () => {
    const a = openWs();
    const id = mkNote(a.w, 'title', 'purgedstash');
    const other = mkNote(a.w, 'other', 'neighbour');
    a.w.store.db
      .prepare(`INSERT OR IGNORE INTO notes(${cols}) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(...row(other, 'x', 'y')); // leaves a stash row for the neighbour
    expect(stashRows(a)).toHaveLength(1);
    const batch = unwrap(a.w.trash.trashNote({}, id)).batchId;
    unwrap(a.w.trash.purgeBatch({}, batch, { confirmed: true }));
    expect(stashRows(a)).toEqual([]);
  });
});
