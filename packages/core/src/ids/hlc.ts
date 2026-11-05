const MS_W = 15;
const CTR_W = 10;

export interface Hlc {
  ms: number;
  counter: number;
}

/** Next HLC after `last`; monotonic across restarts and backwards wall-clock jumps. */
export function tickHlc(last: Hlc, nowMs: number): Hlc {
  const ms = Math.max(nowMs, last.ms);
  if (ms !== last.ms) return { ms, counter: 0 };
  // A full counter carries into the next millisecond instead of failing every later write.
  return last.counter + 1 >= 10 ** CTR_W
    ? { ms: ms + 1, counter: 0 }
    : { ms, counter: last.counter + 1 };
}

/** Fixed-width text so plain string comparison orders HLCs. */
export function formatHlc(h: Hlc): string {
  if (h.counter >= 10 ** CTR_W) throw new Error('HLC counter overflow');
  return `${String(h.ms).padStart(MS_W, '0')}-${String(h.counter).padStart(CTR_W, '0')}`;
}
