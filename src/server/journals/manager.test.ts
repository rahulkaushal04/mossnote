import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client';
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
