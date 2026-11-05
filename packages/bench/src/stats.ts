export interface Summary {
  n: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Nearest-rank percentile (p in 0..100) of an already sorted array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] as number;
}

export function summarize(samples: readonly number[]): Summary {
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.length ? s.reduce((x, y) => x + y, 0) / s.length : NaN;
  return {
    n: s.length,
    min: s[0] ?? NaN,
    mean,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s[s.length - 1] ?? NaN,
  };
}
