import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../packages/core/migrations/index.ts';
import type { Migration } from '../../packages/core/migrations/types.ts';
import { nodeFs } from '../../packages/core/src/db/fs.ts';
import { createNotesApi } from '../../packages/core/src/notes/notes.ts';
import { openStore } from '../../packages/core/src/store/store.ts';
import { createFaultFs, type FaultMode } from '../../packages/core/src/testing/fault.ts';
import { unwrap } from './harness.ts';

const V2: Migration = {
  version: MIGRATIONS.length + 1,
  name: 'extra',
  sql: "CREATE TABLE extra (id TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT; INSERT INTO extra VALUES ('a','1');",
};
const UP = [...MIGRATIONS, V2];

/** CS-8 for the pre-migration backup: ENOSPC/EIO on every fs call of an upgrade, before and after the real call. */
describe('CS-8 fake-fs faults across a migration upgrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mossnote-fsfault-'));
  const v1 = join(dir, 'v1.db');
  // A v1 workspace with data, closed cleanly.
  const s = unwrap(openStore(v1, { migrations: [MIGRATIONS[0]!] })); // a real v1 file: the upgrade runs 0002 too
  const notes = createNotesApi(s);
  for (let i = 0; i < 5; i++)
    unwrap(notes.create({}, { title: `n${i}`, body: `body ${i}`.repeat(50) }));
  s.close();
  const original = readFileSync(v1);

  const attempt = (k: number, mode: FaultMode, code: string) => {
    const d = mkdtempSync(join(tmpdir(), 'mossnote-fsfault-run-'));
    const p = join(d, 'w.db');
    copyFileSync(v1, p);
    const f = createFaultFs(nodeFs);
    try {
      f.arm(k > 0 ? { k, mode, code } : undefined);
      const r = openStore(p, { fs: f.fs, migrations: UP, clock: { now: () => 1 } });
      const calls = [...f.calls];
      if (r.ok) r.value.close();
      return { d, p, r, calls, f };
    } catch (e) {
      rmSync(d, { recursive: true, force: true });
      throw e;
    }
  };

  it('every fs operation of the upgrade fails cleanly and a retry upgrades with the backup intact', () => {
    const dry = attempt(0, 'pre', 'EIO');
    expect(dry.r.ok).toBe(true);
    const n = dry.calls.length;
    rmSync(dry.d, { recursive: true, force: true });
    expect(n).toBeGreaterThanOrEqual(6); // mkdirp, exists, mkdirp, copy, fsync, rename, fsync dir, stat...
    let combos = 0;
    for (let k = 1; k <= n; k++)
      for (const mode of ['pre', 'after'] as const)
        for (const code of ['ENOSPC', 'EIO']) {
          combos++;
          const { d, p, r, calls } = attempt(k, mode, code);
          try {
            const label = `k=${k} (${calls[k - 1]}) ${mode} ${code}`;
            expect(r.ok, label).toBe(false);
            if (!r.ok) expect(r.error.code, label).toBe('io');
            const db = new Database(p, { readonly: true });
            try {
              const ver = db.pragma('user_version', { simple: true });
              expect(db.pragma('integrity_check', { simple: true }), label).toBe('ok');
              const hasExtra = !!db
                .prepare("SELECT 1 FROM sqlite_schema WHERE name = 'extra'")
                .get();
              // all-or-nothing: either untouched at v1, or fully migrated through every pending migration (0002 + extra)
              expect(
                ver === 1 && !hasExtra
                  ? 'v1'
                  : ver === UP.length && hasExtra
                    ? 'v2'
                    : `partial ${ver}`,
                label,
              ).toMatch(/^v[12]$/);
              if (ver === UP.length)
                expect(
                  readdirSync(join(d, 'backups')).filter((x) => x.endsWith('.sqlite')).length,
                  label,
                ).toBe(1);
            } finally {
              db.close();
            }
            // a completed backup is byte-identical to the pre-migration file, never a partial copy
            const bdir = join(d, 'backups');
            for (const b of nodeFs.exists(bdir) ? readdirSync(bdir) : [])
              if (b.endsWith('.sqlite'))
                expect(readFileSync(join(bdir, b)).equals(original), label).toBe(true);
            // retry without faults: upgrades, user data intact
            const again = openStore(p, { migrations: UP, clock: { now: () => 1 } });
            expect(again.ok, label).toBe(true);
            if (again.ok) {
              expect(unwrap(createNotesApi(again.value).list()).length, label).toBe(5);
              again.value.close();
            }
          } finally {
            rmSync(d, { recursive: true, force: true });
          }
        }
    console.log(`fs fault combinations: ${combos} (n=${n} fs calls)`);
    expect(combos).toBe(n * 4);
    rmSync(dir, { recursive: true, force: true });
  });
});
