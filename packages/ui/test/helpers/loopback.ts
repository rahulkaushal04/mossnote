import type { Dispatcher } from '@mossnote/core';
import type { Bridge, RpcEvent, RpcResult } from '@mossnote/core/rpc';

export interface Loopback extends Bridge {
  calls: { method: string; args: unknown }[];
  count(method: string): number;
  /** Replies for `method` are held until release(); the dispatcher still runs immediately. */
  hold(method: string): { release(): void; readonly waiting: number };
  /** The next call(s) to `method` get this result instead of reaching the dispatcher. */
  inject(method: string, result: RpcResult<unknown>, times?: number): void;
  emit(e: RpcEvent): void;
}

/**
 * Test-only bridge: args and replies pass through structuredClone, as they do over IPC, so a
 * non-cloneable payload fails here the same way. Nothing here asserts; tests assert afterwards.
 */
export function createLoopback(d: Dispatcher): Loopback {
  const calls: Loopback['calls'] = [];
  const holds = new Map<string, { gates: (() => void)[] }>();
  const injected = new Map<string, { result: RpcResult<unknown>; times: number }>();
  const listeners = new Set<(e: RpcEvent) => void>();
  const off = d.onEvent((e) => {
    for (const l of [...listeners]) l(structuredClone(e));
  });
  void off;
  return {
    calls,
    count: (m) => calls.filter((c) => c.method === m).length,
    async rpc(method, args) {
      const a = structuredClone(args);
      calls.push({ method, args: a });
      const inj = injected.get(method);
      let p: Promise<RpcResult<unknown>>;
      if (inj && inj.times > 0) {
        inj.times--;
        p = Promise.resolve(inj.result);
      } else p = d.handle(method, a);
      const r = structuredClone(await p);
      const h = holds.get(method);
      if (h) await new Promise<void>((res) => h.gates.push(res));
      return r;
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    hold(method) {
      const h = { gates: [] as (() => void)[] };
      holds.set(method, h);
      return {
        release() {
          holds.delete(method);
          for (const g of h.gates.splice(0)) g();
        },
        get waiting() {
          return h.gates.length;
        },
      };
    },
    inject(method, result, times = 1) {
      injected.set(method, { result, times });
    },
    emit(e) {
      for (const l of [...listeners]) l(structuredClone(e));
    },
  };
}
