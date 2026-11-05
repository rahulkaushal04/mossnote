import { PDF_LIMITS } from '@mossnote/core';
import { describe, expect, it } from 'vitest';
import { createUtilityExtractor, type UtilityLike } from './pdfUtility.ts';

function setup(limits: Parameters<typeof createUtilityExtractor>[0]['limits'] = {}) {
  const kids: (UtilityLike & {
    sent: unknown[];
    killed: number;
    emit(ev: string, v: unknown): void;
  })[] = [];
  const forkArgs: unknown[][] = [];
  let timer: (() => void) | undefined;
  let cleared = 0;
  const ex = createUtilityExtractor({
    entry: '/app/dist/pdfChild.cjs',
    limits,
    fork: (entry, args, options) => {
      forkArgs.push([entry, args, options]);
      const h = new Map<string, (v: never) => void>();
      const k = {
        sent: [] as unknown[],
        killed: 0,
        postMessage(m: unknown) {
          k.sent.push(m);
        },
        on(ev: string, cb: (v: never) => void) {
          h.set(ev, cb);
        },
        kill() {
          k.killed++;
          return true;
        },
        emit(ev: string, v: unknown) {
          h.get(ev)?.(v as never);
        },
      };
      kids.push(k as never);
      return k as never;
    },
    setTimer: (fn) => {
      timer = fn;
      return 1;
    },
    clearTimer: () => void cleared++,
  });
  return { ex, kids, forkArgs, fire: () => timer?.(), cleared: () => cleared };
}

describe('PDF utilityProcess extractor (AT-7, M1)', () => {
  it('forks with a heap limit, sends the path and the caps, resolves the reply and kills the child', async () => {
    const s = setup();
    const p = s.ex.extract('/blob/x');
    expect(s.forkArgs[0]).toEqual([
      '/app/dist/pdfChild.cjs',
      [],
      expect.objectContaining({
        stdio: 'ignore',
        execArgv: [`--max-old-space-size=${PDF_LIMITS.maxOldSpaceMb}`],
      }),
    ]);
    expect(s.kids[0]!.sent).toEqual([
      { path: '/blob/x', limits: { maxPages: PDF_LIMITS.maxPages, maxTextBytes: PDF_LIMITS.maxTextBytes } },
    ]);
    s.kids[0]!.emit('message', { ok: true, text: 'hi', pages: 2, truncated: false });
    await expect(p).resolves.toEqual({ text: 'hi', pages: 2, truncated: false });
    expect(s.kids[0]!.killed).toBe(1);
    expect(s.cleared()).toBe(1);
  });

  it('rejects with the child error, a malformed reply, or text over the cap', async () => {
    const s = setup({ maxTextBytes: 4 });
    const a = s.ex.extract('/a');
    s.kids[0]!.emit('message', { ok: false, error: 'bad pdf' });
    await expect(a).rejects.toThrow('bad pdf');
    const b = s.ex.extract('/b');
    s.kids[1]!.emit('message', { ok: true, text: 5 });
    await expect(b).rejects.toThrow('extraction failed');
    const c = s.ex.extract('/c');
    s.kids[2]!.emit('message', { ok: true, text: 'abcdef', pages: 1, truncated: false });
    await expect(c).rejects.toThrow('over the limit');
  });

  it('kills a child that outlives the timer', async () => {
    const s = setup();
    const p = s.ex.extract('/hang');
    s.fire();
    await expect(p).rejects.toThrow('timed out');
    expect(s.kids[0]!.killed).toBe(1);
  });

  it('rejects when the child dies without replying (crash or memory kill)', async () => {
    const s = setup();
    const p = s.ex.extract('/crash');
    s.kids[0]!.emit('exit', 137);
    await expect(p).rejects.toThrow('exited (137)');
  });

  it('the first outcome wins; a late message after the timeout is ignored', async () => {
    const s = setup();
    const p = s.ex.extract('/x');
    s.fire();
    s.kids[0]!.emit('message', { ok: true, text: 'late', pages: 1, truncated: false });
    await expect(p).rejects.toThrow('timed out');
    expect(s.kids[0]!.killed).toBe(1);
  });

  it('dispose kills every running child; a failing fork rejects', async () => {
    const s = setup();
    const p = s.ex.extract('/x');
    p.catch(() => undefined);
    s.ex.dispose();
    expect(s.kids[0]!.killed).toBe(1);
    const bad = createUtilityExtractor({
      entry: 'x',
      fork: () => {
        throw new Error('no process');
      },
    });
    await expect(bad.extract('/y')).rejects.toThrow('no process');
  });
});
