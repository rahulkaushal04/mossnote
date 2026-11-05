/** mulberry32: small, fast, seeded. The same seed always yields the same stream. */
export interface Rng {
  next(): number;
  int(n: number): number;
  pick<T>(a: readonly T[]): T;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (a) => a[Math.floor(next() * a.length)] as never,
  };
}

/** Per-item stream so any note can be regenerated alone (resume, tests). */
export const subRng = (seed: number, index: number): Rng =>
  makeRng((Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(index + 1, 0xc2b2ae35)) >>> 0);

/** Zipf(s=1) sampler over ranks 0..n-1 by inverse CDF. */
export function zipf(n: number): (r: Rng) => number {
  const cdf = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) cdf[i] = sum += 1 / (i + 1);
  return (r) => {
    const x = r.next() * sum;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cdf[mid] as number) < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}
