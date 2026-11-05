import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { checkIntegrity } from '../../src/integrity/index.ts';
import { sha256 } from '../../src/db/hash.ts';
import { createTxRunner } from '../../src/db/tx.ts';
import type { Db } from '../../src/db/types.ts';
import { createDraftsApi } from '../../src/drafts/index.ts';
import { fingerprint } from '../../src/ids/identity.ts';
import { nodeFs } from '../../src/db/fs.ts';
import { openStore } from '../../src/store/store.ts';
import { openWorkspace } from '../../src/workspace.ts';
import { MIN, setup, unwrap, DAY } from '../notes/util.ts';
import { tmp } from '../store/helpers.ts';

/** Records every prepared statement and can fail chosen ones. */
function recorder(failOn?: RegExp) {
  const sqls: string[] = [];
  let raw!: Db;
  return {
    sqls,
    get raw() {
      return raw;
    },
    wrap(d: Db): Db {
      raw = d;
      const hit = (sql: string) => {
        sqls.push(sql);
        if (failOn?.test(sql)) throw Object.assign(new Error('injected'), { code: 'SQLITE_IOERR' });
      };
      return {
        prepare(sql) {
          const s = d.prepare(sql);
          return {
            run: (...p) => (hit(sql), s.run(...p)),
            get: (...p) => (hit(sql), s.get(...p)),
            all: (...p) => (hit(sql), s.all(...p)),
          };
        },
        exec: (sql) => (hit(sql), d.exec(sql)),
        pragma: (src, o) => (hit(`PRAGMA ${src}`), d.pragma(src, o)),
        get inTransaction() {
          return d.inTransaction;
        },
        close: () => d.close(),
      };
    },
  };
}

/** `EXPLAIN QUERY PLAN` detail lines for a recorded statement (values never matter to the plan). */
function plan(raw: Db, sql: string): string[] {
  const n = (sql.match(/\?/g) ?? []).length;
  return (
    raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(n).fill('x')) as { detail: string }[]
  ).map((r) => r.detail);
}

describe('M5 note rows reference a base consistently', () => {
  it('base_version_id is null or the version whose hash equals base_content_hash; throttled rows log hashes only', () => {
    const w = setup();
    const n = unwrap(w.notes.create({}, { title: 't', body: 'v0' }));
    unwrap(w.notes.update({}, n.id, { body: 'v1' })); // throttled
    unwrap(w.notes.update({}, n.id, { body: 'v2' })); // throttled
    const throttled = w.lastRow();
    expect(throttled).toMatchObject({ noteVersionId: null, baseVersionId: null });
    expect(throttled.contentHash).toBe(sha256('v2'));
    expect(throttled.baseContentHash).toBe(sha256('v1'));
    w.clock.t += 6 * MIN;
    unwrap(w.notes.update({}, n.id, { body: 'v3' })); // versioned, but head (v0) is not v2's text
    expect(w.lastRow().baseVersionId).toBeNull();
    w.clock.t += 6 * MIN;
    unwrap(w.notes.update({}, n.id, { body: 'v4' })); // head holds v3 = the base text
    const row = w.lastRow();
    const base = unwrap(w.versions.get(row.baseVersionId!));
    expect(base.contentHash).toBe(row.baseContentHash);
    unwrap(w.notes.update({ actor: 'agent-1' }, n.id, { body: 'agent text' }));
    unwrap(w.versions.restore({}, base.id));
    // the invariant over every row
    const bad = w.store.db
      .prepare(
        `SELECT c.seq FROM change_log c JOIN versions v ON v.id = c.base_version_id
         WHERE v.content_hash IS NOT c.base_content_hash`,
      )
      .all();
    expect(bad).toEqual([]);
  });
});

describe('M7 close keeps pending draft text and scrubs purged text from the WAL', () => {
  it('reopening after close shows the last keystrokes', () => {
    const path = join(tmp(), 'w.db');
    const a = unwrap(openWorkspace(path));
    const note = unwrap(a.notes.create({}, { title: 't', body: 'saved' }));
    unwrap(
      a.drafts.write(note.id, 'saved plus last keystrokes', {
        rev: note.rev,
        contentHash: note.contentHash,
      }),
    );
    expect(a.close()).toEqual({ ok: true, value: undefined });
    const b = unwrap(openWorkspace(path));
    expect(unwrap(b.drafts.recover())[0]).toMatchObject({ body: 'saved plus last keystrokes' });
    b.close();
  });

  it('a purge leaves no marker in the WAL without any manual checkpoint', () => {
    const path = join(tmp(), 'w.db');
    const marker = 'WAL-PURGE-MARKER-5521';
    const ws = unwrap(openWorkspace(path));
    const note = unwrap(ws.notes.create({}, { title: 'T', body: `body ${marker}` }));
    unwrap(ws.notes.update({}, note.id, { body: `body ${marker} two` }));
    const wal = `${path}-wal`;
    expect(readFileSync(wal).toString('latin1')).toContain(marker); // sanity: it is in the WAL
    const { batchId } = unwrap(ws.trash.trashNote({}, note.id));
    unwrap(ws.trash.purgeBatch({}, batchId, { confirmed: true }));
    expect(readFileSync(wal).toString('latin1')).not.toContain(marker);
    expect(readFileSync(path).toString('latin1')).not.toContain(marker);
    ws.close();
  });

  it('a failing checkpoint does not turn a committed purge into an error', () => {
    const r = recorder(/wal_checkpoint/);
    const w = setup({ wrapDb: r.wrap });
    const n = unwrap(w.notes.create({}, { title: 't', body: 'x' }));
    const { batchId } = unwrap(w.trash.trashNote({}, n.id));
    expect(w.trash.purgeBatch({}, batchId, { confirmed: true }).ok).toBe(true);
    expect(w.tombstones()).toEqual([n.id]);
  });
});

describe('M8 openStore is guarded by default', () => {
  it('a second open is unavailable and a corrupt file is corrupt and untouched', () => {
    const dir = tmp();
    const p = join(dir, 'n.db');
    const a = unwrap(openStore(p));
    const b = openStore(p);
    expect(b).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    a.close();
    const bad = join(dir, 'bad', 'n.db');
    mkdirSync(join(dir, 'bad'));
    writeFileSync(bad, 'this is not a database, not at all, definitely not');
    const before = readFileSync(bad);
    expect(openStore(bad)).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    expect(readFileSync(bad)).toEqual(before);
  });

  it('a foreign SQLite file is refused before it is switched to WAL', () => {
    const dir = tmp();
    const p = join(dir, 'foreign.db');
    const f = new Database(p);
    f.pragma('journal_mode = DELETE');
    f.exec('CREATE TABLE notes (id TEXT)');
    f.close();
    const before = readFileSync(p);
    const r = openStore(p, { guards: [] });
    expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(readFileSync(p)).toEqual(before); // header byte 18/19 would flip to WAL
    expect(existsSync(`${p}-wal`)).toBe(false);
  });
});

describe('M9 scale: hot queries use indexes', () => {
  it('purge redaction, readChanges, tag merge and notes-with-tag never scan change_log / note_tags', () => {
    const r = recorder();
    const w = setup({ wrapDb: r.wrap });
    const f = unwrap(w.folders.create({}, { name: 'F' }));
    const ta = unwrap(w.tags.create({}, 'a'));
    const tb = unwrap(w.tags.create({}, 'b'));
    for (let i = 0; i < 5; i++) {
      const n = unwrap(w.notes.create({}, { title: `n${i}`, body: 'x', folderId: f.id }));
      unwrap(w.tags.tagNote({}, n.id, tb.id));
    }
    unwrap(w.tags.rename({}, tb.id, 'A', { confirmMerge: true }));
    const { batchId } = unwrap(w.trash.trashFolder({}, f.id));
    unwrap(w.trash.purgeBatch({}, batchId, { confirmed: true }));
    unwrap(w.store.changelog.read({ afterDeviceSeq: { [w.store.deviceId]: 2 }, limit: 10 }));
    unwrap(w.notes.list({ limit: 10 }));
    void ta;
    const relevant = [
      ...new Set(
        r.sqls.filter(
          (s) =>
            /change_log|note_tags/.test(s) &&
            /^(UPDATE|SELECT|WITH|DELETE|INSERT)/i.test(s.trim()) &&
            !/^INSERT INTO change_log/i.test(s.trim()),
        ),
      ),
    ];
    expect(relevant.length).toBeGreaterThan(4);
    for (const sql of relevant) {
      const lines = plan(r.raw, sql);
      const scans = lines.filter((l) => /^SCAN (change_log|note_tags)\b/.test(l));
      expect(scans, `${sql}\n${lines.join('\n')}`).toEqual([]);
    }
    // "notes with this tag" (MCP tag grants, facets) is an index search too
    const q = plan(r.raw, 'SELECT note_id FROM note_tags WHERE tag_id = ?');
    expect(q.join(' ')).toMatch(/note_tags_tag/);
    expect(q.join(' ')).not.toMatch(/^SCAN/);
  });

  it('readChanges pages by (device, seq) over 20k rows', () => {
    const w = setup();
    const dev = '01HF7YAT00ZZZZZZZZZZZZZZZZ';
    w.store.db
      .prepare(
        `WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 20000)
         INSERT INTO change_log(id, entity, entity_id, op, hlc, device_id, seq, origin, schema_version, created_at)
         SELECT printf('%026d', n), 'setting', 'k', 'update', printf('%015d-0000000000', n), ?, n, 'remote', 1, 1 FROM s`,
      )
      .run(dev);
    const t0 = performance.now();
    const rows = unwrap(w.store.changelog.read({ afterDeviceSeq: { [dev]: 19_000 }, limit: 100 }));
    const ms = performance.now() - t0;
    expect(rows.map((x) => x.seq)).toEqual(Array.from({ length: 100 }, (_, i) => 19_001 + i));
    expect(ms).toBeLessThan(500); // generous; the plan test above is the real guard
  });
});

describe('notes.list', () => {
  it('never selects bodies, pages with limit and cursor, and keeps the trashed filter', () => {
    const r = recorder();
    const w = setup({ wrapDb: r.wrap });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      w.clock.t += 1000;
      ids.push(unwrap(w.notes.create({}, { title: `n${i}`, body: 'secret body' })).id);
    }
    const f = unwrap(w.folders.create({}, { name: 'F' }));
    const inF = unwrap(w.notes.create({}, { title: 'in', body: 'b', folderId: f.id }));
    unwrap(w.trash.trashFolder({}, f.id));
    r.sqls.length = 0;
    const p1 = unwrap(w.notes.list({ limit: 2 }));
    expect(p1.map((n) => n.title)).toEqual(['n4', 'n3']);
    const last = p1.at(-1)!;
    const p2 = unwrap(
      w.notes.list({ limit: 2, cursor: { updatedAt: last.updatedAt, id: last.id } }),
    );
    expect(p2.map((n) => n.title)).toEqual(['n2', 'n1']);
    expect(unwrap(w.notes.list({ trashed: true })).map((n) => n.id)).toEqual([inF.id]);
    expect(unwrap(w.notes.list({})).length).toBe(5);
    expect('body' in p1[0]!).toBe(false);
    expect(r.sqls.filter((s) => /FROM notes/.test(s) && /\bbody\b/.test(s))).toEqual([]);
    void ids;
  });
});

describe('M10 a BEGIN that errors after it ran does not leave the connection in a transaction', () => {
  it('rolls back before returning the error', () => {
    const raw = new Database(':memory:');
    const db: Db = {
      prepare(sql) {
        const s = raw.prepare(sql);
        return {
          run: (...p) => {
            const r = s.run(...p);
            if (/^BEGIN/.test(sql))
              throw Object.assign(new Error('late'), { code: 'SQLITE_IOERR' });
            return r;
          },
          get: (...p) => s.get(...p),
          all: (...p) => s.all(...p),
        };
      },
      exec: (sql) => raw.exec(sql),
      pragma: (s, o) => raw.pragma(s, o),
      get inTransaction() {
        return raw.inTransaction;
      },
      close: () => raw.close(),
    };
    const run = createTxRunner(db);
    expect(run(() => ({ ok: true, value: 1 }))).toMatchObject({ ok: false, error: { code: 'io' } });
    expect(raw.inTransaction).toBe(false);
  });
});

describe('minors', () => {
  it('draftSeq deletes drafts inside the saving transaction, and not when the save fails', () => {
    const w = setup();
    const drafts = createDraftsApi(w.store);
    const n = unwrap(w.notes.create({}, { title: 't', body: 'a' }));
    const base = { rev: n.rev, contentHash: n.contentHash };
    unwrap(drafts.write(n.id, 'a1', base));
    const seq = unwrap(drafts.flush())[n.id]!;
    const stale = w.notes.update({ draftSeq: seq, expectedContentHash: sha256('other') }, n.id, {
      body: 'a1',
    });
    expect(stale).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(unwrap(drafts.recover())).toHaveLength(1);
    unwrap(w.notes.update({ draftSeq: seq }, n.id, { body: 'a1' }));
    expect(unwrap(drafts.recover())).toHaveLength(0);
    // a newer draft (higher seq) survives
    unwrap(drafts.write(n.id, 'a2', base));
    const seq2 = unwrap(drafts.flush())[n.id]!;
    unwrap(w.notes.update({ draftSeq: seq2 - 1 }, n.id, { body: 'a1 more' }));
    expect(unwrap(drafts.recover())).toHaveLength(1);
    drafts.dispose();
  });

  it('recover() treats a note inside a trashed folder as changed', () => {
    const w = setup();
    const drafts = createDraftsApi(w.store);
    const f = unwrap(w.folders.create({}, { name: 'F' }));
    const n = unwrap(w.notes.create({}, { title: 't', body: 'a', folderId: f.id }));
    unwrap(drafts.write(n.id, 'typed', { rev: n.rev, contentHash: n.contentHash }));
    unwrap(drafts.flush());
    expect(unwrap(drafts.recover())[0]!.baseChanged).toBe(false);
    unwrap(w.trash.trashFolder({}, f.id));
    expect(unwrap(drafts.recover())[0]!.baseChanged).toBe(true);
    drafts.dispose();
  });

  it('public APIs reject non-string ids and draft text with validation, not internal', () => {
    const w = setup();
    const drafts = createDraftsApi(w.store);
    const bad = 5 as unknown as string;
    const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);
    expect(code(w.notes.get(bad))).toBe('validation');
    expect(code(w.notes.update({}, bad, { title: 'x' }))).toBe('validation');
    expect(code(w.notes.setFavorite({}, bad, true))).toBe('validation');
    expect(code(w.notes.move({}, bad, null))).toBe('validation');
    expect(code(w.folders.get(bad))).toBe('validation');
    expect(code(w.folders.rename({}, bad, 'n'))).toBe('validation');
    expect(code(w.folders.move({}, bad, null))).toBe('validation');
    expect(code(w.tags.get(bad))).toBe('validation');
    expect(code(w.tags.rename({}, bad, 'n'))).toBe('validation');
    expect(code(w.tags.listForNote(bad))).toBe('validation');
    expect(code(w.versions.list(bad))).toBe('validation');
    expect(code(w.versions.get(bad))).toBe('validation');
    expect(code(w.versions.force(bad, 'remote'))).toBe('validation');
    expect(code(w.versions.release(bad, 'x'))).toBe('validation');
    const base = { rev: 1, contentHash: sha256('') };
    expect(code(drafts.write('n', 7 as unknown as string, base))).toBe('validation');
    expect(code(drafts.write(bad, 'x', base))).toBe('validation');
    expect(code(drafts.flush(bad))).toBe('validation');
    expect(code(drafts.discardUpTo(bad, 1))).toBe('validation');
    expect(unwrap(drafts.flush())).toEqual({}); // nothing bad is stuck pending
    expect(code(w.notes.create({ actor: 'x'.repeat(200) }, { title: 't', body: 'b' }))).toBe(
      'validation',
    );
    drafts.dispose();
  });

  it('checkIntegrity reports corruption even when the backups listing fails', () => {
    const dir = tmp();
    const p = join(dir, 'n.db');
    writeFileSync(p, 'garbage garbage garbage garbage');
    writeFileSync(join(dir, 'backups'), 'a file, so readdir throws ENOTDIR');
    expect(checkIntegrity(p)).toMatchObject({ ok: false, error: { code: 'corrupt' } });
  });

  it('local purge writes the entity type on every tombstone', () => {
    const w = setup();
    const f = unwrap(w.folders.create({}, { name: 'F' }));
    const n = unwrap(w.notes.create({}, { title: 't', body: 'b', folderId: f.id }));
    const { batchId } = unwrap(w.trash.trashFolder({}, f.id));
    unwrap(w.trash.purgeBatch({}, batchId, { confirmed: true }));
    expect(w.store.db.prepare('SELECT entity_id, entity FROM tombstones').all()).toEqual(
      expect.arrayContaining([
        { entity_id: f.id, entity: 'folder' },
        { entity_id: n.id, entity: 'note' },
      ]),
    );
  });

  it('the device fingerprint ignores st_dev (volume remounts) but not inode/birthtime', () => {
    const p = join(tmp(), 'f.db');
    writeFileSync(p, 'x');
    const at = (dev: number, ino = 7) => ({
      ...nodeFs,
      stat: () => ({ dev, ino, birthtimeMs: 5, size: 1 }),
    });
    expect(fingerprint(at(1), p)).toBe(fingerprint(at(2), p));
    expect(fingerprint(at(1), p)).not.toBe(fingerprint(at(1, 8), p));
  });
});

void DAY;
