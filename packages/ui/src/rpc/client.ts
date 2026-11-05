import type { Args, Bridge, MethodName, Reply, RpcEvent, RpcResult } from '@mossnote/core/rpc';

export interface Client {
  call<M extends MethodName>(
    method: M,
    ...args: Record<string, never> extends Args<M> ? [args?: Args<M>] : [args: Args<M>]
  ): Promise<RpcResult<Reply<M>>>;
  onEvent(cb: (e: RpcEvent) => void): () => void;
}

/** Typed calls over a Bridge. A rejected bridge call (window gone, IPC failure) becomes `unavailable`. */
export function createClient(bridge: Bridge): Client {
  return {
    async call(method, ...args) {
      try {
        return (await bridge.rpc(method, args[0] ?? {})) as RpcResult<never>;
      } catch {
        return { ok: false, error: { code: 'unavailable', message: 'The app is not responding.' } };
      }
    },
    onEvent: (cb) => bridge.onEvent(cb),
  };
}
