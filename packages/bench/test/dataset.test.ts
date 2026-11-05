import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openWorkspace } from '../../core/src/index.ts';
import { ensureDataset, logicalHash, populate } from '../src/dataset.ts';
import { percentile } from '../src/stats.ts';
import { folderCountFor, genNote } from '../src/text.ts';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'bench-test-'));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function build(seed: number, count: number, partial?: number): string {
  const p = join(tmp(), 'w.sqlite');
  // Resumed build: first a short run, then continue to the full count.
  if (partial) populate(p, count, seed, undefined, partial);
  populate(p, count, seed);
  const ws = openWorkspace(p);
  if (!ws.ok) throw new Error(ws.error.message);
  try {
    return logicalHash(ws.value);
  } finally {
    ws.value.close();
  }
}

describe('PB-1 determinism', () => {
  it('same seed gives the same logical hash, a different seed differs', () => {
    const a = build(7, 40);
    expect(build(7, 40)).toBe(a);
    expect(build(8, 40)).not.toBe(a);
  });

  it('writes through the real APIs: the search index sees every note', () => {
    const p = join(tmp(), 'w.sqlite');
    populate(p, 25, 3);
    const ws = openWorkspace(p);
    if (!ws.ok) throw new Error(ws.error.message);
    const docs = (
      ws.value.store.db.prepare('SELECT count(*) AS c FROM search_doc').get() as { c: number }
    ).c;
    const v = ws.value.search.verify();
    ws.value.close();
    expect(docs).toBe(25);
    expect(v).toEqual({ ok: true, value: { ok: true } });
  });

  it('ensureDataset caches on disk and returns the stored hash', () => {
    const dir = tmp();
    const first = ensureDataset(dir, 20, 5);
    const second = ensureDataset(dir, 20, 5);
    expect(second).toEqual(first);
    expect(first.hash).toBe(build(5, 20));
  });

  it('a build interrupted and resumed equals an uninterrupted one', () => {
    expect(build(11, 30, 12)).toBe(build(11, 30));
  });
});

describe('PB-1 realistic content', () => {
  const ctx = { seed: 42, total: 6000, folders: folderCountFor(6000) };
  const notes = Array.from({ length: 6000 }, (_, i) => genNote(ctx, i));

  it('sizes: median about 1.5 KB, p99 about 50 KB', () => {
    const sizes = notes.map((n) => Buffer.byteLength(n.body)).sort((a, b) => a - b);
    expect(percentile(sizes, 50)).toBeGreaterThan(1200);
    expect(percentile(sizes, 50)).toBeLessThan(1900);
    expect(percentile(sizes, 99)).toBeGreaterThan(30_000);
    expect(percentile(sizes, 99)).toBeLessThan(80_000);
  });

  it('has headings, lists, checklists, links, tags, favorites, trashed notes and nested folders', () => {
    const all = notes.map((n) => n.body).join('\n');
    expect(all).toMatch(/^## /m);
    expect(all).toMatch(/^- \[ \] /m);
    expect(all).toMatch(/^- \[x\] /m);
    expect(all).toMatch(/^- (?!\[)/m);
    expect(all).toMatch(/\]\(https:\/\//);
    expect(all).toMatch(/\[\[/);
    expect(notes.some((n) => n.tags.length >= 3)).toBe(true);
    const fav = notes.filter((n) => n.favorite).length / notes.length;
    const trashed = notes.filter((n) => n.trashed).length / notes.length;
    expect(fav).toBeGreaterThan(0.01);
    expect(fav).toBeLessThan(0.06);
    expect(trashed).toBeGreaterThan(0.005);
    expect(trashed).toBeLessThan(0.05);
  });

  it('creation times are strictly increasing, so the export order is stable', () => {
    for (let i = 1; i < notes.length; i++)
      expect((notes[i] as { createdAt: number }).createdAt).toBeGreaterThan(
        (notes[i - 1] as { createdAt: number }).createdAt,
      );
  });
});
