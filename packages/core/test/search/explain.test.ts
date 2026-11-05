import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { find, mkNote, openWs, unwrap } from './util.ts';

/** Records every prepared SELECT with its arguments, so the plan of the REAL query can be explained. */
function recorder() {
  const seen: { sql: string; args: unknown[] }[] = [];
  let raw!: Db;
  return {
    seen,
    wrapDb(d: Db): Db {
      raw = d;
      return {
        prepare: (sql) => {
          const s = d.prepare(sql);
          const rec = (args: unknown[]) => {
            if (/^\s*(WITH|SELECT)/i.test(sql)) seen.push({ sql, args });
          };
          return {
            run: (...p) => s.run(...p),
            get: (...p) => (rec(p), s.get(...p)),
            all: (...p) => (rec(p), s.all(...p)),
          };
        },
        exec: (sql) => d.exec(sql),
        pragma: (s, o) => d.pragma(s, o),
        get inTransaction() {
          return d.inTransaction;
        },
        close: () => d.close(),
      };
    },
    plan(match: RegExp): string {
      const hit = [...seen].reverse().find((x) => match.test(x.sql));
      if (!hit) throw new Error(`no statement matched ${match}`);
      const rows = raw.prepare(`EXPLAIN QUERY PLAN ${hit.sql}`).all(...hit.args) as {
        detail: string;
      }[];
      return rows.map((r) => r.detail).join('\n');
    },
  };
}

describe('SR-3 query plans: no full scan of notes for a typical query', () => {
  const setup = () => {
    const rec = recorder();
    const a = openWs({ wrapDb: rec.wrapDb });
    for (let i = 0; i < 50; i++) mkNote(a.w, `title ${i}`, `body text ${i} walrus`);
    return { rec, ...a };
  };

  it.each([
    ['relevance', {}],
    ['updated', { sort: 'updated' }],
    ['created', { sort: 'created' }],
  ])('text query, sort %s: FTS index, notes by primary key', (_n, extra) => {
    const { rec, w } = setup();
    find(w, 'walrus', extra);
    const plan = rec.plan(/WITH hit AS MATERIALIZED/);
    expect(plan).toMatch(/VIRTUAL TABLE INDEX/);
    expect(plan).not.toMatch(/SCAN (n|notes)\b/);
    expect(plan).toMatch(/SEARCH n USING (INDEX sqlite_autoindex_notes_1|PRIMARY KEY)/);
  });

  it('highlight step looks rows up by rowid list over an FTS match, not a table scan', () => {
    const { rec, w } = setup();
    find(w, 'walrus');
    const plan = rec.plan(/highlight\(/);
    expect(plan).toMatch(/VIRTUAL TABLE INDEX/);
    expect(plan).not.toMatch(/SCAN notes/);
  });

  it('filter-only query by updated uses the notes_updated index (no sort of the whole table)', () => {
    const { rec, w } = setup();
    find(w, '', { filters: { favorite: false } });
    const plan = rec.plan(/NOT MATERIALIZED/);
    expect(plan).toMatch(/notes_updated|SCAN n USING INDEX/);
    expect(plan).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/);
  });

  it('is exercised by the real API (sanity)', () => {
    const { w } = setup();
    expect(unwrap(w.search.status())).toEqual({ state: 'ready' });
  });
});
