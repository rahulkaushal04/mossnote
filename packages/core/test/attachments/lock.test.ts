import { describe, expect, it } from 'vitest';
import { createJobMutex, createKeyedLock } from '../../src/attachments/lock.ts';
import { sleep } from './util.ts';

describe('keyed lock (C3)', () => {
  it('runs tasks for one key strictly one after another, in order', async () => {
    const lock = createKeyedLock();
    const log: string[] = [];
    const task = (name: string, ms: number) =>
      lock.run('k', async () => {
        log.push(`start ${name}`);
        await sleep(ms);
        log.push(`end ${name}`);
        return name;
      });
    const out = await Promise.all([task('a', 30), task('b', 5), task('c', 1)]);
    expect(out).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('different keys do not wait for each other', async () => {
    const lock = createKeyedLock();
    const log: string[] = [];
    const slow = lock.run('x', async () => {
      await sleep(60);
      log.push('x');
    });
    await lock.run('y', () => void log.push('y'));
    await slow;
    expect(log).toEqual(['y', 'x']);
  });

  it('a throwing task does not wedge the chain and the map empties', async () => {
    const lock = createKeyedLock();
    const bad = lock.run('k', () => {
      throw new Error('boom');
    });
    await expect(bad).rejects.toThrow('boom');
    expect(await lock.run('k', () => 'fine')).toBe('fine');
    expect(lock.size).toBe(0);
  });

  it('job mutex serialises and reports busy', async () => {
    const m = createJobMutex();
    expect(m.busy).toBe(false);
    const first = m.run(() => sleep(20));
    expect(m.busy).toBe(true);
    await first;
    expect(m.busy).toBe(false);
  });
});
