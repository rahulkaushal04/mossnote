import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { nodeFs, type FsPort } from '../../src/db/fs.ts';
import { sha256 } from '../../src/db/hash.ts';
import { migrate, schemaDump, userVersion } from '../../src/db/migrate.ts';
import { openDb } from '../../src/db/open.ts';
import { openStore } from '../../src/store/store.ts';
import { MIGRATIONS, FIXED, V2, V3, V3_BAD, open, tmp } from '../store/helpers.ts';

const LIST = [...MIGRATIONS, V2, V3];
const bytes = (p: string) => sha256(readFileSync(p));
const run = (path: string, migs: typeof LIST, fs: FsPort = nodeFs) => {
  const db = openDb(path);
  try {
    return migrate(db, fs, path, migs, join(path, '..', 'backups'), () => 'ID');
  } finally {
    db.close();
  }
};
const dump = (path: string) => {
  const db = openDb(path);
  try {
    return schemaDump(db);
  } finally {
    db.close();
  }
};

describe('CS-1 migrations', () => {
  it('upgrading from every earlier version equals a fresh database, and keeps rows', () => {
    const d = tmp();
    const fresh = join(d, 'fresh.db');
    expect(run(fresh, LIST).ok).toBe(true);
    for (const v of [0, 1, 2, 3]) {
      const p = join(d, `from-v${v}.db`);
      expect(run(p, LIST.slice(0, v)).ok).toBe(true); // "fixture" at schema version v
      if (v >= 1) {
        const db = openDb(p);
        db.prepare("INSERT INTO meta(key, value) VALUES ('sample', 'kept')").run();
        db.close();
      }
      const r = run(p, LIST);
      expect(r.ok && r.value).toMatchObject({ from: v, to: LIST.length });
      expect(dump(p), `from v${v}`).toBe(dump(fresh));
      if (v >= 1) {
        const db = openDb(p);
        expect(db.prepare("SELECT value FROM meta WHERE key='sample'").get()).toEqual({
          value: 'kept',
        });
        db.close();
      }
    }
    expect(dump(fresh)).toContain(`user_version=${LIST.length}`);
  });

  it('sets the durability pragmas', () => {
    const d = tmp();
    const db = openDb(join(d, 'p.db'), { platform: 'darwin' });
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(2); // FULL
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('fullfsync', { simple: true })).toBe(1);
    expect(db.pragma('checkpoint_fullfsync', { simple: true })).toBe(1);
    db.close();
  });

  it('refuses a newer schema and leaves the file byte-identical', () => {
    const d = tmp();
    const p = join(d, 'w', 'n.db');
    open(p, { migrations: LIST, clock: FIXED }).close();
    const before = bytes(p);
    const r = openStore(p, { migrations: MIGRATIONS });
    expect(r).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(bytes(p)).toBe(before);
  });

  it('rejects non-contiguous migration lists', () => {
    const r = run(join(tmp(), 'x.db'), [MIGRATIONS[0]!, { ...V3 }]);
    expect(r).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});

describe('CS-2 failed migration', () => {
  /** v1 database in WAL mode with data, then two pending migrations where the SECOND fails. */
  const setup = () => {
    const d = tmp();
    const p = join(d, 'w.db');
    expect(run(p, [MIGRATIONS[0]!]).ok).toBe(true);
    const db = openDb(p);
    db.prepare("INSERT INTO meta(key, value) VALUES ('k', 'precious')").run();
    db.close();
    return { d, p };
  };

  it('rolls back every pending migration: file byte-identical, backup taken, v2 effects gone', () => {
    const { d, p } = setup();
    const before = bytes(p);
    // The real 0002 (virtual table, triggers) is inside the rolled-back transaction.
    const r = run(p, [...MIGRATIONS, V2, V3_BAD]);
    expect(r).toMatchObject({ ok: false });
    expect(bytes(p)).toBe(before);
    const db = new Database(p, { readonly: true });
    expect(userVersion(db)).toBe(1);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name IN ('extra','extra2','search_doc','note_fts') OR name LIKE 'search_%'",
        )
        .all(),
    ).toEqual([]);
    db.close();
    const backups = readdirSync(join(d, 'backups'));
    expect(backups).toEqual(['pre-migration-v1-ID.sqlite']);
    expect(bytes(join(d, 'backups', backups[0]!))).toBe(before);
  });

  it('a failing backup (ENOSPC) aborts before any migration runs', () => {
    const { d, p } = setup();
    const before = bytes(p);
    const fs: FsPort = {
      ...nodeFs,
      copyFile(a, b) {
        writeFileSync(b, 'partial');
        throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
      },
    };
    const r = run(p, LIST, fs);
    expect(r).toMatchObject({ ok: false, error: { code: 'io' } });
    expect(bytes(p)).toBe(before);
    expect(readdirSync(join(d, 'backups'))).toEqual([]); // partial temp removed, nothing renamed
    const db = new Database(p, { readonly: true });
    expect(userVersion(db)).toBe(1);
    db.close();
  });

  it('a successful upgrade backs up the pre-migration file', () => {
    const { d, p } = setup();
    const before = bytes(p);
    const r = run(p, LIST);
    expect(r.ok && r.value.backupPath).toBe(join(d, 'backups', 'pre-migration-v1-ID.sqlite'));
    expect(bytes(join(d, 'backups', 'pre-migration-v1-ID.sqlite'))).toBe(before);
  });
});
