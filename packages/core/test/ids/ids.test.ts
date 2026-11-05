import { describe, expect, it } from 'vitest';
import { formatHlc, tickHlc } from '../../src/ids/hlc.ts';
import { createUlid } from '../../src/ids/ulid.ts';

describe('ulid', () => {
  it('is 26 Crockford chars and strictly increasing within one ms and across a backwards clock', () => {
    let t = 1000;
    const u = createUlid(
      () => t,
      (n) => new Uint8Array(n),
    ); // all-zero randomness: only the counter can order them
    const a = u();
    const b = u();
    t = 500; // clock jumps back
    const c = u();
    t = 2000;
    const d = u();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect([a, b, c, d]).toEqual([a, b, c, d].toSorted());
    expect(new Set([a, b, c, d]).size).toBe(4);
  });
  it('sorts by time first', () => {
    let t = 1;
    const u = createUlid(() => t);
    const early = u();
    t = 10 ** 12;
    expect(u() > early).toBe(true);
  });
});

describe('hlc', () => {
  it('never goes backwards, including across a backwards wall clock and after restart state', () => {
    let h = { ms: 0, counter: 0 };
    const seen: string[] = [];
    for (const now of [100, 100, 100, 50, 10, 200, 200]) {
      h = tickHlc(h, now);
      seen.push(formatHlc(h));
    }
    expect(seen).toEqual([...seen].toSorted());
    expect(new Set(seen).size).toBe(seen.length);
    expect(tickHlc({ ms: 200, counter: 1 }, 0)).toEqual({ ms: 200, counter: 2 });
  });
  it('string order matches numeric order for large counters', () => {
    expect(formatHlc({ ms: 5, counter: 999_999 }) < formatHlc({ ms: 5, counter: 1_000_000 })).toBe(
      true,
    );
  });
});
