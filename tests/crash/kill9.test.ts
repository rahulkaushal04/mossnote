import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { sha256 } from '../../packages/core/src/db/hash.ts';
import { createDraftsApi } from '../../packages/core/src/drafts/index.ts';
import { integrityGuard } from '../../packages/core/src/integrity/index.ts';
import { lockGuard } from '../../packages/core/src/lock/index.ts';
import { openStore } from '../../packages/core/src/store/store.ts';
import { mulberry32, seededText } from './seed.ts';

const SEEDS = Number(process.env.CRASH_SEEDS ?? 10);
const PARALLEL = 4;
const stats = { walLeft: 0, draftUsed: 0, savedUsed: 0, maxLost: 0 };
const GRACE_MS = 1000; // CS-7: at most the last 1 s of typing may be lost
const child = join(import.meta.dirname, 'typing-child.ts');

async function runSeed(seed: number): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), `mossnote-crash-${seed}-`));
  try {
    const rng = mulberry32(seed * 7919 + 1);
    const killAfter = 300 + Math.floor(rng() * 2200); // random moment, measured from "ready"
    const keys: { len: number; at: number }[] = [];
    const proc = spawn(process.execPath, ['--import', 'tsx', child, dir, String(seed)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let killedAt = 0;
    let buf = '';
    const exited = new Promise<void>((res) => proc.once('exit', () => res()));
    await new Promise<void>((resolve, reject) => {
      proc.once('error', reject);
      proc.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split('\n');
        buf = lines.pop()!;
        for (const l of lines) {
          if (l === 'ready' && !killedAt) {
            setTimeout(() => {
              killedAt = Date.now();
              proc.kill('SIGKILL');
            }, killAfter);
          } else if (l.startsWith('k ')) keys.push({ len: Number(l.slice(2)), at: Date.now() });
        }
      });
      void exited.then(resolve);
    });
    if (!killedAt) return `seed ${seed}: child died before ready`;

    const wal = join(dir, 'n.db-wal');
    if (existsSync(wal) && statSync(wal).size > 0) stats.walLeft += 1;
    // A read-only connection must recover the leftover WAL by itself and leave the files unmodified.
    const hashes = () => [join(dir, 'n.db'), wal].map((f) => sha256(readFileSync(f)));
    const before = hashes();
    const ro = new Database(join(dir, 'n.db'), { readonly: true, fileMustExist: true });
    const roDrafts = ro.prepare('SELECT COUNT(*) AS c FROM drafts').get() as { c: number };
    const roIc = ro.pragma('integrity_check', { simple: true });
    ro.close();
    if (roIc !== 'ok') return `seed ${seed}: read-only integrity_check ${String(roIc)}`;
    if (hashes().join() !== before.join()) return `seed ${seed}: read-only open modified db/wal`;
    // Reopen through the real path: lock (OS freed it), read-only quick_check, WAL recovery.
    const r = openStore(join(dir, 'n.db'), { guards: [lockGuard, integrityGuard] });
    if (!r.ok) return `seed ${seed}: reopen failed ${r.error.code} ${r.error.message}`;
    const s = r.value;
    try {
      const ic = s.db.pragma('integrity_check', { simple: true });
      if (ic !== 'ok') return `seed ${seed}: integrity_check ${String(ic)}`;
      const note = s.db.prepare('SELECT id, body, rev FROM notes LIMIT 1').get() as
        { id: string; body: string; rev: number } | undefined;
      if (!note) return `seed ${seed}: note missing`;
      const rwDrafts = s.db.prepare('SELECT COUNT(*) AS c FROM drafts').get() as { c: number };
      if (rwDrafts.c !== roDrafts.c)
        return `seed ${seed}: read-only saw ${roDrafts.c} drafts, rw ${rwDrafts.c}`;
      const rec = createDraftsApi(s).recover();
      if (!rec.ok) return `seed ${seed}: recover failed`;
      const d = rec.value.find((x) => x.noteId === note.id);
      // A draft typed against the note's current rev is newer than the saved body; a stale one is not.
      const recovered = d && d.base.rev === note.rev ? d.body : note.body;
      stats[d && d.base.rev === note.rev ? 'draftUsed' : 'savedUsed'] += 1;
      const full = seededText(seed);
      if (!full.startsWith(recovered))
        return `seed ${seed}: recovered text is not a prefix (len ${[...recovered].length})`;
      const need = keys
        .filter((k) => k.at <= killedAt - GRACE_MS)
        .reduce((m, k) => Math.max(m, k.len), 0);
      const got = [...recovered].length;
      stats.maxLost = Math.max(stats.maxLost, (keys.at(-1)?.len ?? 0) - got);
      if (got < need)
        return `seed ${seed}: recovered ${got} < required ${need} (typed ${keys.at(-1)?.len}, killed after ${killAfter} ms)`;
      return null;
    } finally {
      s.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe(`CS-7 kill -9 during typing (${SEEDS} seeds)`, () => {
  it(
    'recovers an exact prefix covering all keystrokes older than 1 s, integrity ok, mode ok',
    async () => {
      const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
      const failures: string[] = [];
      const t0 = Date.now();
      await Promise.all(
        Array.from({ length: PARALLEL }, async () => {
          for (let seed = seeds.shift(); seed !== undefined; seed = seeds.shift()) {
            const f = await runSeed(seed);
            if (f) failures.push(f);
          }
        }),
      );
      console.log(
        `crash: ${SEEDS} seeds, ${failures.length} failures, ${Date.now() - t0} ms, ${JSON.stringify(stats)}`,
      );
      expect(failures).toEqual([]);
    },
    60_000 + SEEDS * 6_000,
  );
});
