import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IntegrityError } from '../boot';
import { openDatabase } from '../db/client';
import { NewerJournalError } from '../db/migrate';
import { AppError } from '../errors';
import { acquireLock } from '../lock';
import { makeJournalsApp, type JournalsApp } from '../testing/journals';
import { writeOlderJournal } from '../testing/older';

let t: JournalsApp;
beforeEach(async () => {
  t = await makeJournalsApp();
});
afterEach(() => {
  t.close();
});

const create = (name: string, template = 'default') => t.manager.create({ name, template });

describe('which journal opens at start', () => {
  it('opens the one used last, not the first by name', async () => {
    await create('Aardvark');
    await create('Zebra');
    await t.manager.activate('aardvark');
    t.stop();
    const again = await makeJournalsApp({ dir: t.dir });
    try {
      expect(again.manager.activeId).toBe('aardvark');
    } finally {
      again.stop();
    }
  });

  it('prefers the legacy journal.db when nothing was remembered', async () => {
    await create('Newer one');
    t.stop();
    fs.rmSync(path.join(t.config.dataDir, 'active-journal'));
    const legacy = path.join(t.config.dataDir, 'journal.db');
    await writeOlderJournal(legacy);
    // The most recently changed file is the other one, but the legacy name still wins.
    fs.utimesSync(legacy, new Date(2020, 0, 1), new Date(2020, 0, 1));
    const again = await makeJournalsApp({ dir: t.dir });
    try {
      expect(again.manager.activeId).toBe('journal');
    } finally {
      again.stop();
    }
  });

  it('falls back to the most recently changed journal when the remembered one is gone', async () => {
    await create('Keeps');
    await create('Goes');
    t.stop();
    fs.rmSync(path.join(t.config.dataDir, 'goes.db'));
    const again = await makeJournalsApp({ dir: t.dir });
    try {
      expect(again.manager.activeId).toBe('keeps');
    } finally {
      again.stop();
    }
  });

  it('lets MOSS_JOURNAL win over the one used last', async () => {
    await create('One');
    await create('Two');
    t.stop();
    const again = await makeJournalsApp({ dir: t.dir, env: { MOSS_JOURNAL: 'one' } });
    try {
      expect(again.manager.activeId).toBe('one');
    } finally {
      again.stop();
    }
  });
});

/** True when `A.db` and `a.db` are the same file here, as on macOS and Windows by default. */
const folderIgnoresCase = (dir: string): boolean => {
  const probe = path.join(dir, 'case-probe.db');
  fs.writeFileSync(probe, '');
  try {
    return fs.existsSync(path.join(dir, 'CASE-PROBE.db'));
  } finally {
    fs.rmSync(probe);
  }
};

describe('a journal named in a different case than its file', () => {
  const startedAs = async (id: string) => {
    await create('Work');
    t.stop();
    return makeJournalsApp({ dir: t.dir, env: { MOSS_JOURNAL: id } });
  };

  it('opens the existing journal under the id its file has', async () => {
    const again = await startedAs('WORK');
    try {
      expect(again.manager.activeId).toBe('work');
      expect(again.manager.get('work').active).toBe(true);
      expect(again.manager.list().map((j) => [j.id, j.active])).toEqual([['work', true]]);
    } finally {
      again.stop();
    }
  });

  it("keeps the journal's snapshots under its own id, with none filed under the typed name", async () => {
    await create('Work');
    const before = fs.readdirSync(t.config.backupsDir);
    expect(before.length).toBeGreaterThanOrEqual(1);
    t.stop();
    const again = await makeJournalsApp({ dir: t.dir, env: { MOSS_JOURNAL: 'WORK' } });
    try {
      const after = fs.readdirSync(again.config.backupsDir);
      expect(after).toEqual(expect.arrayContaining(before));
      expect(after.every((name) => name.startsWith('work-'))).toBe(true);
      expect(again.manager.activeId).toBe('work');
    } finally {
      again.stop();
    }
  });

  it('serves the data and backups of that journal through the API', async () => {
    await create('Work');
    const before = fs.readdirSync(t.config.backupsDir);
    t.stop();
    const again = await makeJournalsApp({ dir: t.dir, env: { MOSS_JOURNAL: 'WORK' } });
    try {
      expect((await again.call('GET', '/api/data/info')).status).toBe(200);
      const backups = (await (await again.call('GET', '/api/data/backups')).json()) as {
        items: { name: string }[];
      };
      expect(backups.items.map((b) => b.name)).toEqual(expect.arrayContaining(before));
      const health = (await (await again.call('GET', '/api/health')).json()) as {
        journal: string;
      };
      expect(health.journal).toBe('work');
    } finally {
      again.stop();
    }
  });

  it('makes a journal under the typed name when no journal matches it in any case', async () => {
    await create('Work');
    t.stop();
    const again = await makeJournalsApp({ dir: t.dir, env: { MOSS_JOURNAL: 'Fresh' } });
    try {
      expect(again.manager.activeId).toBe('Fresh');
      expect(fs.existsSync(path.join(again.config.dataDir, 'Fresh.db'))).toBe(true);
    } finally {
      again.stop();
    }
  });

  it('prefers an exact match when the file system keeps two names apart', async () => {
    const dir = t.dir;
    if (folderIgnoresCase(path.join(dir, 'data'))) return;
    await create('Foo');
    t.stop();
    fs.copyFileSync(path.join(dir, 'data', 'foo.db'), path.join(dir, 'data', 'Foo.db'));
    const again = await makeJournalsApp({ dir, env: { MOSS_JOURNAL: 'Foo' } });
    try {
      expect(again.manager.activeId).toBe('Foo');
    } finally {
      again.stop();
    }
  });

  it('is not made again by a new journal whose name only differs in case from a file', async () => {
    t.stop();
    const first = await makeJournalsApp({ dir: t.dir, env: { MOSS_JOURNAL: 'WORK' } });
    try {
      expect(first.manager.activeId).toBe('WORK');
      const made = await first.manager.create({ name: 'Work', template: 'default' });
      expect(made.id).toBe('work-2');
      expect(
        first.manager
          .list()
          .map((j) => j.id)
          .sort(),
      ).toEqual(['WORK', 'work-2']);
      expect(first.manager.get('work-2').active).toBe(true);
    } finally {
      first.stop();
    }
  });

  it('is not made again by a new journal whose name only differs in case from a snapshot', async () => {
    await create('Other');
    fs.mkdirSync(t.config.backupsDir, { recursive: true });
    fs.copyFileSync(
      path.join(t.config.dataDir, 'other.db'),
      path.join(t.config.backupsDir, 'WORK-20260101-1200-manual.db'),
    );
    const made = await t.manager.create({ name: 'Work', template: 'default' });
    expect(made.id).toBe('work-2');
  });
});

/** Overwrite part of a journal file's pages, the way real damage looks, and drop its WAL files. */
function damage(file: string): void {
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
  const fd = fs.openSync(file, 'r+');
  try {
    fs.writeSync(fd, Buffer.alloc(4096 * 6, 0xa7), 0, 4096 * 6, 4096 * 20);
  } finally {
    fs.closeSync(fd);
  }
}

/** A journal file that a later version of Mossnote made: it holds a migration this build lacks. */
function writeNewerJournal(file: string): void {
  const db = openDatabase(file);
  db.sqlite.exec(
    'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER)',
  );
  db.sqlite
    .prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('from-later', 9999999999999)",
    )
    .run();
  db.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  db.sqlite.close();
}

describe('a journal named at start that cannot be opened', () => {
  /** "Foo" is the journal asked for and "Audit" a healthy one that was used last. */
  const twoJournals = async () => {
    await create('Foo');
    await create('Audit');
    t.stop();
  };

  it('stops start-up for a damaged journal instead of opening another one', async () => {
    await twoJournals();
    damage(path.join(t.config.dataDir, 'foo.db'));
    const again = await makeJournalsApp({
      dir: t.dir,
      env: { MOSS_JOURNAL: 'foo' },
      start: false,
    });
    try {
      await expect(again.manager.start()).rejects.toBeInstanceOf(IntegrityError);
      expect(again.manager.activeId).toBeNull();
      // Nothing else was opened, so nothing else holds a lock.
      expect(fs.readdirSync(again.config.dataDir).filter((f) => f.endsWith('.lock'))).toEqual([]);
    } finally {
      again.stop();
    }
  });

  it('stops start-up for a journal from a newer version instead of opening another one', async () => {
    await create('Audit');
    t.stop();
    writeNewerJournal(path.join(t.config.dataDir, 'future.db'));
    const again = await makeJournalsApp({
      dir: t.dir,
      env: { MOSS_JOURNAL: 'future' },
      start: false,
    });
    try {
      await expect(again.manager.start()).rejects.toBeInstanceOf(NewerJournalError);
      expect(again.manager.activeId).toBeNull();
    } finally {
      again.stop();
    }
  });

  it('also stops when the name only differs in case from the damaged file', async () => {
    await twoJournals();
    damage(path.join(t.config.dataDir, 'foo.db'));
    const again = await makeJournalsApp({
      dir: t.dir,
      env: { MOSS_JOURNAL: 'FOO' },
      start: false,
    });
    try {
      await expect(again.manager.start()).rejects.toBeInstanceOf(IntegrityError);
      expect(again.manager.activeId).toBeNull();
    } finally {
      again.stop();
    }
  });

  it('opens the named journal when another one is the damaged one', async () => {
    await twoJournals();
    damage(path.join(t.config.dataDir, 'audit.db'));
    const again = await makeJournalsApp({ dir: t.dir, env: { MOSS_JOURNAL: 'foo' } });
    try {
      expect(again.manager.activeId).toBe('foo');
    } finally {
      again.stop();
    }
  });

  it('still falls back to another journal when none was named', async () => {
    await twoJournals();
    // "Audit" was used last, so it is the one remembered and the one tried first.
    damage(path.join(t.config.dataDir, 'audit.db'));
    const again = await makeJournalsApp({ dir: t.dir });
    try {
      expect(again.manager.activeId).toBe('foo');
    } finally {
      again.stop();
    }
  });

  it('still raises the problem when no journal can be opened and none was named', async () => {
    await twoJournals();
    damage(path.join(t.config.dataDir, 'foo.db'));
    damage(path.join(t.config.dataDir, 'audit.db'));
    const again = await makeJournalsApp({ dir: t.dir, start: false });
    try {
      await expect(again.manager.start()).rejects.toBeInstanceOf(IntegrityError);
    } finally {
      again.stop();
    }
  });
});

describe('changes that arrive together', () => {
  it('run one at a time: two journals made at once get two ids and both exist', async () => {
    const [a, b] = await Promise.all([create('Same name'), create('Same name')]);
    expect([a.id, b.id].sort()).toEqual(['same-name', 'same-name-2']);
    expect(fs.existsSync(path.join(t.config.dataDir, 'same-name.db'))).toBe(true);
    expect(fs.existsSync(path.join(t.config.dataDir, 'same-name-2.db'))).toBe(true);
    // Exactly one is open, and exactly one holds a lock.
    expect(fs.readdirSync(t.config.dataDir).filter((f) => f.endsWith('.lock'))).toHaveLength(1);
  });
});

describe('a journal that something else has open', () => {
  it('is not renamed or deleted from under the other copy of Mossnote', async () => {
    await create('Busy');
    await create('Current');
    // A lock held by a live process other than this one: the parent process stands in for it.
    const held = acquireLock(path.join(t.config.dataDir, 'busy.lock'), process.ppid);
    try {
      await expect(t.manager.rename('busy', 'Renamed')).rejects.toMatchObject({
        code: 'conflict',
        details: { reason: 'in_use' },
      });
      await expect(
        t.manager.remove('busy', { confirmName: 'Busy', finalSnapshot: false }),
      ).rejects.toBeInstanceOf(AppError);
      expect(fs.existsSync(path.join(t.config.dataDir, 'busy.db'))).toBe(true);
    } finally {
      held.release();
    }
  });
});

describe('journals this build cannot read or fully open', () => {
  it('lets a journal from a newer version be deleted by name, and never writes to it before that', async () => {
    await create('Current');
    const file = path.join(t.config.dataDir, 'future.db');
    const db = openDatabase(file);
    db.sqlite.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER)',
    );
    db.sqlite
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('from-later', 9999999999999)",
      )
      .run();
    db.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    db.sqlite.close();

    const info = t.manager.list().find((j) => j.id === 'future');
    expect(info?.status).toBe('needs_newer_app');
    await expect(t.manager.exportFrom('future', () => 'x')).rejects.toMatchObject({
      details: { reason: 'needs_newer_app' },
    });
    const result = await t.manager.remove('future', { confirmName: 'future', finalSnapshot: true });
    expect(result.snapshot).toMatch(/^future-.*-manual\.db$/);
    expect(fs.existsSync(file)).toBe(false);
    expect(t.manager.activeId).toBe('current');
  });

  it('asks for a journal from an older version to be opened once before it is exported', async () => {
    await create('Current');
    await writeOlderJournal(path.join(t.config.dataDir, 'ancient.db'), {
      schema: 1,
      name: 'Ancient',
    });
    await expect(t.manager.exportFrom('ancient', () => 'x')).rejects.toMatchObject({
      details: { reason: 'needs_upgrade' },
    });
    // Opening it brings it up to date, and then it can be exported from anywhere.
    await t.manager.activate('ancient');
    await t.manager.activate('current');
    await expect(t.manager.exportFrom('ancient', (ctx) => ctx.config.journal)).resolves.toBe(
      'ancient',
    );
  });
});
