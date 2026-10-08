import { beforeAll, describe, expect, it } from 'vitest';
import type { Sqlite } from '@server/db/types';
import { memoryPoolForTests } from '../testing/sqlite';
import type { FilePool } from '../pool/types';

let pool: FilePool;
let db: Sqlite;
beforeAll(async () => {
  pool = await memoryPoolForTests();
});

let counter = 0;
let lastName = '';
const fresh = (): Sqlite => {
  counter++;
  lastName = `/test-${counter}.db`;
  const connection = pool.open(lastName);
  connection.exec('CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT, size REAL, data BLOB)');
  return connection;
};

describe('statements', () => {
  it('reports changes and the new row id from run', () => {
    db = fresh();

    const first = db.prepare('INSERT INTO item (name) VALUES (?)').run('a');
    const second = db.prepare('INSERT INTO item (name) VALUES (?)').run('b');
    const update = db.prepare('UPDATE item SET name = ?').run('c');

    expect(first).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(second.lastInsertRowid).toBe(2);
    expect(update.changes).toBe(2);
  });

  it('returns rows as objects, or as arrays after raw()', () => {
    db = fresh();
    db.prepare('INSERT INTO item (name, size) VALUES (?, ?)').run('a', 1.5);

    const object = db.prepare('SELECT name, size FROM item').get();
    const array = db.prepare('SELECT name, size FROM item').raw().get();
    const all = db.prepare('SELECT name FROM item').all();

    expect(object).toEqual({ name: 'a', size: 1.5 });
    expect(array).toEqual(['a', 1.5]);
    expect(all).toEqual([{ name: 'a' }]);
  });

  it('returns undefined for no row and an empty list for no rows', () => {
    db = fresh();

    expect(db.prepare('SELECT * FROM item WHERE id = ?').get(9)).toBeUndefined();
    expect(db.prepare('SELECT * FROM item').all()).toEqual([]);
  });

  it('binds null, numbers, strings, bigints and bytes', () => {
    db = fresh();
    const insert = db.prepare('INSERT INTO item (name, size, data) VALUES (?, ?, ?)');

    insert.run(null, 2, new Uint8Array([1, 2, 3]));
    insert.run('text', 2.5, null);
    const [bytes, plain] = db.prepare('SELECT name, size, data FROM item ORDER BY id').all() as {
      name: string | null;
      size: number;
      data: Uint8Array | null;
    }[];

    expect(bytes?.name).toBeNull();
    expect(Array.from(bytes?.data ?? [])).toEqual([1, 2, 3]);
    expect(plain).toEqual({ name: 'text', size: 2.5, data: null });
  });

  it('takes the parameters as one array too', () => {
    db = fresh();
    db.prepare('INSERT INTO item (name, size) VALUES (?, ?)').run(['a', 1]);

    expect(db.prepare('SELECT name FROM item').get()).toEqual({ name: 'a' });
  });

  it('refuses values SQLite cannot store, as better-sqlite3 does', () => {
    db = fresh();
    const insert = db.prepare('INSERT INTO item (name) VALUES (?)');

    expect(() => insert.run(true)).toThrow(TypeError);
    expect(() => insert.run(undefined)).toThrow(TypeError);
    expect(() => insert.run({})).toThrow(TypeError);
  });

  it('keeps working after more distinct statements than the cache holds', () => {
    db = fresh();
    db.prepare('INSERT INTO item (name) VALUES (?)').run('kept');

    for (let n = 0; n < 300; n++) db.prepare(`SELECT ${n} AS n FROM item`).get();

    expect(db.prepare('SELECT name FROM item').get()).toEqual({ name: 'kept' });
  });

  it('throws at prepare time for SQL that does not parse', () => {
    db = fresh();

    expect(() => db.prepare('SELEC nothing')).toThrow(/syntax error/);
  });
});

describe('errors', () => {
  it('carry the SQLite error name as code', () => {
    db = fresh();
    db.exec('CREATE UNIQUE INDEX item_name ON item (name)');
    db.prepare('INSERT INTO item (name) VALUES (?)').run('same');

    let thrown: unknown;
    try {
      db.prepare('INSERT INTO item (name) VALUES (?)').run('same');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
  });
});

describe('transactions', () => {
  it('commits the work when it returns', () => {
    db = fresh();
    const add = db.transaction((name: string) =>
      db.prepare('INSERT INTO item (name) VALUES (?)').run(name),
    );

    add('a');

    expect(db.prepare('SELECT count(*) AS n FROM item').get()).toEqual({ n: 1 });
  });

  it('rolls everything back when the work throws, and rethrows', () => {
    db = fresh();
    const failing = db.transaction(() => {
      db.prepare('INSERT INTO item (name) VALUES (?)').run('lost');
      throw new Error('boom');
    });

    expect(() => failing()).toThrow('boom');

    expect(db.prepare('SELECT count(*) AS n FROM item').get()).toEqual({ n: 0 });
  });

  it('nests: an inner failure undoes only the inner work', () => {
    db = fresh();
    const inner = db.transaction(() => {
      db.prepare('INSERT INTO item (name) VALUES (?)').run('inner');
      throw new Error('inner failed');
    });
    const outer = db.transaction(() => {
      db.prepare('INSERT INTO item (name) VALUES (?)').run('outer');
      try {
        inner();
      } catch {
        // The outer work carries on without the inner rows.
      }
    });

    outer();

    expect(db.prepare('SELECT name FROM item').all()).toEqual([{ name: 'outer' }]);
  });

  it('offers the lock modes as better-sqlite3 does', () => {
    db = fresh();
    const add = db.transaction(() => db.prepare('INSERT INTO item (name) VALUES (?)').run('a'));

    add.immediate();
    add.exclusive();
    add.deferred();

    expect(db.prepare('SELECT count(*) AS n FROM item').get()).toEqual({ n: 3 });
  });
});

describe('pragma, exec and backup', () => {
  it('reads a pragma as rows, or as one value when asked', () => {
    db = fresh();

    expect(db.pragma('foreign_keys')).toEqual([{ foreign_keys: 0 }]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(0);
    db.pragma('foreign_keys = ON');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('runs several statements with exec', () => {
    db = fresh();

    db.exec("INSERT INTO item (name) VALUES ('a'); INSERT INTO item (name) VALUES ('b');");

    expect(db.prepare('SELECT count(*) AS n FROM item').get()).toEqual({ n: 2 });
  });

  it('copies the database to another file', async () => {
    db = fresh();
    db.prepare('INSERT INTO item (name) VALUES (?)').run('copied');

    await db.backup('/copy.db');

    const copy = pool.open('/copy.db');
    expect(copy.prepare('SELECT name FROM item').get()).toEqual({ name: 'copied' });
    copy.close();
  });

  it('keeps the data when closed and opened again', () => {
    db = fresh();
    db.prepare('INSERT INTO item (name) VALUES (?)').run('kept');
    db.close();

    const again = pool.open(lastName);

    expect(again.prepare('SELECT name FROM item').get()).toEqual({ name: 'kept' });
    again.close();
  });
});
