import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFaultDb, dumpDb } from '../../packages/core/src/testing/fault.ts';
import type { Result } from '../../packages/core/src/result.ts';
import { openCtl, unwrap } from './harness.ts';

const BODY = (i: number, kb: number) =>
  Array.from({ length: kb * 128 }, (_, j) => `${i}:${j}:${(i * 7919 + j * 104729).toString(36)}`)
    .join(' ')
    .slice(0, kb * 1024);

/**
 * Real SQLITE_FULL: the database is capped at (current page count + extra) pages and a growing
 * sequence of mutations runs until it hits the cap, at the cap's every size from 0..extra.
 */
describe('CS-8 real SQLITE_FULL (PRAGMA max_page_count)', () => {
  const totals = { failed: 0, ok: 0 };
  const EXTRAS = [...Array.from({ length: 40 }, (_, i) => i), 60, 90, 130, 200];
  for (const extra of EXTRAS)
    it(`cap = pages + ${extra}`, { timeout: 120_000 }, () => {
      const dir = mkdtempSync(join(tmpdir(), 'mossnote-full-'));
      const clock = { t: 1_700_000_000_000 };
      const ctl = createFaultDb();
      const w = openCtl(dir, clock, ctl);
      try {
        const raw = ctl.raw;
        const pages = () => raw.pragma('page_count', { simple: true }) as number;
        const cap = (n: number) => raw.pragma(`max_page_count = ${n}`);
        const seedNote = unwrap(w.notes.create({}, { title: 'seed', body: 'seed' })).id;
        const steps: (() => Result<unknown>)[] = [];
        for (let i = 0; i < 40; i++) {
          steps.push(() => w.notes.create({}, { title: `big ${i}`, body: BODY(i, 24) }));
          steps.push(() => {
            clock.t += 6 * 60_000;
            return w.notes.update({}, seedNote, { body: BODY(100 + i, 20) }); // new version each time
          });
        }
        cap(pages() + extra);
        let failed = 0;
        for (const step of steps) {
          const before = dumpDb(raw);
          const t0 = clock.t;
          const r = step();
          if (r.ok) {
            totals.ok++;
            continue;
          }
          failed++;
          totals.failed++;
          expect(r.error.code).toBe('io');
          expect((r.error.cause as { code?: string } | undefined)?.code).toBe('SQLITE_FULL');
          expect(dumpDb(raw)).toBe(before);
          expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
          expect(raw.inTransaction).toBe(false);
          // space freed: the very next write succeeds, then cap again
          const limit = pages() + extra;
          cap(pages() + 100_000);
          clock.t = t0;
          unwrap(w.notes.create({}, { title: 'after full', body: 'fits' }));
          cap(Math.max(limit, pages() + extra));
        }
        expect(failed).toBeGreaterThan(0);
        cap(pages() + 100_000);
        expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
        w.close();
        const re = openCtl(dir, clock, createFaultDb());
        expect(re.notes.list().ok).toBe(true);
        re.close();
      } finally {
        try {
          w.close();
        } catch {
          /* closed */
        }
        rmSync(dir, { recursive: true, force: true });
      }
    });
  it('hit SQLITE_FULL many times in total', () => {
    console.log(`SQLITE_FULL failures asserted: ${totals.failed}, successes: ${totals.ok}`);
    expect(totals.failed).toBeGreaterThan(40);
  });
});
