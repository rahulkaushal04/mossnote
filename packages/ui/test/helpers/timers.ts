/** Manual timers: nothing fires until advance(). Environment-free (no React, no DOM). */
export function manualTimers() {
  let now = 0;
  let n = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  return {
    setTimeout(fn: () => void, ms: number) {
      q.set(++n, { at: now + ms, fn });
      return n;
    },
    clearTimeout(h: unknown) {
      q.delete(h as number);
    },
    get now() {
      return now;
    },
    get pending() {
      return q.size;
    },
    /** Runs due timers in order, letting promises settle after each. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...q.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        q.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await tick();
      }
      now = end;
      await tick();
    },
  };
}
