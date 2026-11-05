import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { MIGRATIONS } from '../../migrations/index.ts';
import type { Migration } from '../../migrations/types.ts';
import { openStore, type OpenOptions, type Store } from '../../src/store/store.ts';

const dirs: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

export const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'mossnote-core-'));
  dirs.push(d);
  return d;
};

/** Open and fail loudly; the store is closed after the test. */
export function open(path: string, opts: OpenOptions = {}): Store {
  const r = openStore(path, { guards: [], ...opts }); // openStore guards by default; most tests want none
  if (!r.ok) throw new Error(`openStore failed: ${r.error.code} ${r.error.message}`);
  stores.push(r.value);
  return r.value;
}

/** Test-only migrations after the shipped ones (versions follow MIGRATIONS.length). */
const N = MIGRATIONS.length;
export const V2: Migration = {
  version: N + 1,
  name: 'extra',
  sql: "CREATE TABLE extra (id TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT; INSERT INTO extra VALUES ('a','1');",
};
export const V3: Migration = {
  version: N + 2,
  name: 'extra2',
  sql: 'CREATE TABLE extra2 (id TEXT PRIMARY KEY) STRICT; ALTER TABLE extra ADD COLUMN w TEXT;',
};
export const V3_BAD: Migration = {
  version: N + 2,
  name: 'bad',
  sql: 'CREATE TABLE extra2 (id TEXT PRIMARY KEY) STRICT; INSERT INTO no_such_table VALUES (1);',
};
export const FIXED = { now: () => 1_700_000_000_000 };
export { MIGRATIONS };
