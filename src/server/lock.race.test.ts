import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from './testing/helpers';

// Real processes asking for one lock at the same moment, which no in-process test can do: exactly
// one of every pair may get it. Each runs the real lock.ts, which Node reads as it is.
const LOCK_MODULE = new URL('./lock.ts', import.meta.url).href;
const RACER = `
const { acquireLock, AlreadyRunningError } = await import(${JSON.stringify(LOCK_MODULE)});
const [file, startAt] = [process.argv[1], Number(process.argv[2])];
while (Date.now() < startAt) { /* wait for the shared start time */ }
let result;
try {
  acquireLock(file);
  result = 'won';
} catch (error) {
  result = error instanceof AlreadyRunningError ? 'refused' : 'error: ' + error.message;
}
process.stdout.write(result + '\\n');
// stay alive until told to stop, however late the other one starts
process.stdin.resume();
`;

const racer = (lockPath: string, startAt: number) =>
  new Promise<{ result: string; stop: () => void }>((resolve) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', RACER, lockPath, String(startAt)],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.endsWith('\n')) resolve({ result: out.trim(), stop: () => child.kill() });
    });
  });

const PAIRS_PER_BATCH = 20;
const BATCHES = 2;

let dir: string;
beforeEach(() => {
  dir = makeTempDir();
});
afterEach(() => {
  removeDir(dir);
});

/** Run the pairs, all at once within a batch, and return what each pair's two processes said. */
async function race(prepare: (lockPath: string) => void): Promise<string[][]> {
  const outcomes: string[][] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const startAt = Date.now() + 1_500;
    const pairs = Array.from({ length: PAIRS_PER_BATCH }, (_, i) => {
      const lockPath = path.join(dir, `b${batch}-p${i}.lock`);
      prepare(lockPath);
      return Promise.all([racer(lockPath, startAt), racer(lockPath, startAt)]).then((both) => {
        for (const one of both) one.stop();
        return both.map((one) => one.result);
      });
    });
    outcomes.push(...(await Promise.all(pairs)).map((pair) => pair.sort()));
  }
  return outcomes;
}

describe('two processes asking for the same lock at once', () => {
  it('give it to exactly one when there is no lock yet', async () => {
    const outcomes = await race(() => undefined);
    expect(outcomes).toHaveLength(PAIRS_PER_BATCH * BATCHES);
    for (const pair of outcomes) expect(pair).toEqual(['refused', 'won']);
  }, 60_000);

  it('give it to exactly one when the lock they find is stale', async () => {
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
    const deadPid = dead.stdout.toString();
    const outcomes = await race((lockPath) => {
      fs.writeFileSync(lockPath, deadPid);
    });
    for (const pair of outcomes) expect(pair).toEqual(['refused', 'won']);
  }, 60_000);
});
