import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../packages/core/src/db/hash.ts';
import { verifyPackageFile } from '../../packages/core/src/portability/backup.ts';
import { listLibrary } from '../../packages/core/src/portability/library.ts';
import { applyPendingRestore, JOURNAL } from '../../packages/core/src/portability/restore.ts';
import { openWorkspace } from '../../packages/core/src/workspace.ts';
import { mulberry32 } from './seed.ts';

const SEEDS = Number(process.env.CRASH_SEEDS ?? 4);
const child = join(import.meta.dirname, 'portability-child.ts');

function must<T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
const count = (db: { prepare(sql: string): { get(): unknown } }, table: string): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/** Runs the child; kills it `killAfterMs` after "ready" (or lets it finish when undefined). Resolves with its stdout lines. */
function run(args: string[], killAfterMs?: number): Promise<{ lines: string[]; killed: boolean }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', child, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    const lines: string[] = [];
    let buf = '';
    let killed = false;
    proc.once('error', reject);
    proc.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      const parts = buf.split('\n');
      buf = parts.pop()!;
      for (const l of parts) {
        lines.push(l);
        if (l === 'ready' && killAfterMs !== undefined)
          setTimeout(() => {
            killed = true;
            proc.kill('SIGKILL');
          }, killAfterMs);
      }
    });
    proc.once('exit', () => resolve({ lines, killed }));
  });
}

function seedWorkspace(dir: string, notes: number) {
  const w = must(openWorkspace(join(dir, 'w.db'), { attachments: { pdf: null } }));
  const f = must(w.folders.create({}, { name: 'F' }));
  for (let i = 0; i < notes; i++) must(w.notes.create({}, { title: `n${i}`, body: `body ${i} `.repeat(40), folderId: i % 2 ? f.id : null }));
  return w;
}

describe('portability kill -9', () => {
  it('PT-6: a backup killed at a random moment never leaves a listed-valid package that fails verification', async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const dir = mkdtempSync(join(tmpdir(), `mossnote-bk-${seed}-`));
      try {
        seedWorkspace(dir, 1500).close();
        const rng = mulberry32(seed * 104729);
        const r = await run(['backup', dir], 100 + Math.floor(rng() * 1800));
        expect(r.killed, `seed ${seed}`).toBe(true);
        const lib = listLibrary(join(dir, 'w.db'));
        for (const b of lib) {
          expect(b.id.endsWith('.tmp')).toBe(false);
          if (b.valid) await expect(verifyPackageFile(join(dir, 'backups', b.id)), `seed ${seed} ${b.id}`).resolves.toBeDefined();
        }
        const w = must(openWorkspace(join(dir, 'w.db'), { attachments: { pdf: null } }));
        try {
          expect(w.store.db.pragma('integrity_check', { simple: true })).toBe('ok');
          expect(count(w.store.db, 'notes')).toBe(1500);
          // the startup sweep removed temp files and snapshots
          expect(existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')).filter((n) => n.endsWith('.tmp') || n.startsWith('.snap')) : []).toEqual([]);
        } finally {
          w.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 180_000);

  it('PT-5: an import killed at a random moment resumes (or restarts) without duplicates', async () => {
    const src = mkdtempSync(join(tmpdir(), 'mossnote-imp-src-'));
    try {
      for (let i = 0; i < 600; i++) {
        mkdirSync(join(src, `d${i % 5}`), { recursive: true });
        writeFileSync(join(src, `d${i % 5}`, `n${i}.md`), `---\ntitle: "Imp ${i}"\ntags: ["t${i % 3}"]\n---\nimported body ${i}\n`);
      }
      for (let seed = 1; seed <= SEEDS; seed++) {
        const dir = mkdtempSync(join(tmpdir(), `mossnote-imp-${seed}-`));
        try {
          must(openWorkspace(join(dir, 'w.db'), { attachments: { pdf: null } })).close();
          const rng = mulberry32(seed * 7919 + 3);
          const r = await run(['import', dir, src, '50'], 150 + Math.floor(rng() * 2500));
          const w = must(openWorkspace(join(dir, 'w.db'), { attachments: { pdf: null }, portability: { importLimits: { batchNotes: 50 } } }));
          try {
            expect(w.store.db.pragma('integrity_check', { simple: true })).toBe('ok');
            const mid = count(w.store.db, 'notes');
            expect(mid % 50, `seed ${seed}: partial batch visible (${mid})`).toBe(0); // atomic per batch
            const done = r.lines.includes('imported');
            if (!done) {
              if (w.portability.hasPendingImport()) expect(must(await w.portability.import({})).added).toBe(600);
              else if (mid === 0) expect(must(await w.portability.import({ dir: src })).added).toBe(600); // killed during the scan
            }
            expect(count(w.store.db, 'notes'), `seed ${seed}`).toBe(600);
            expect((w.store.db.prepare('SELECT count(DISTINCT title) AS n FROM notes').get() as { n: number }).n).toBe(600);
            expect(count(w.store.db, 'tags')).toBe(3);
            const again = await w.portability.import({});
            expect(again.ok).toBe(false); // nothing left to resume
            expect(count(w.store.db, 'notes')).toBe(600);
            expect(readdirSync(dir).filter((n) => n.startsWith('.import-'))).toEqual([]);
          } finally {
            w.close();
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  }, 240_000);

  it('C1: a real kill -9 at every restore journal step ends in the restored data and never loses the live data', async () => {
    let steps = 0;
    for (let k = 1; k <= 12; k++) {
      const dir = mkdtempSync(join(tmpdir(), `mossnote-rs-${k}-`));
      try {
        const w = seedWorkspace(dir, 20);
        const b = must(await w.portability.backup({ kind: 'manual' }));
        for (let i = 0; i < 5; i++) must(w.notes.create({}, { title: `late ${i}`, body: 'late' }));
        must(await w.portability.restore({ id: b.id }));
        w.close();
        const original = sha256(readFileSync(join(dir, 'w.db')));
        const r = await run(['apply', dir, String(k)]);
        const finished = r.lines.includes('applied');
        if (finished) {
          steps = k - 1; // k is beyond the last step: the run completed
          expect(existsSync(join(dir, JOURNAL))).toBe(false);
        } else {
          const aside = readdirSync(dir).filter((n) => n.startsWith('pre-restore-'));
          const places = [join(dir, 'w.db'), ...aside.map((a) => join(dir, a, 'w.db'))].filter((p) => existsSync(p));
          expect(places.some((p) => sha256(readFileSync(p)) === original), `step ${k} lost the live database`).toBe(true);
          must(applyPendingRestore(join(dir, 'w.db')));
        }
        const after = must(openWorkspace(join(dir, 'w.db'), { attachments: { pdf: null } }));
        try {
          expect(count(after.store.db, 'notes'), `step ${k}`).toBe(20);
          expect(after.store.db.pragma('integrity_check', { simple: true })).toBe('ok');
        } finally {
          after.close();
        }
        if (finished) break;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    expect(steps).toBeGreaterThanOrEqual(7);
  }, 240_000);
});
