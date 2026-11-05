import { act } from 'react';
import type { Bridge, RpcResult } from '@mossnote/core/rpc';
import type { Booted } from './app';
import { typeInto } from './app';
import { waitFor } from './dom';
import type { Env } from './workspace';

export const box = () => document.querySelector<HTMLInputElement>('#search-input')!;
export const rows = () => [
  ...document.querySelectorAll<HTMLElement>('ul[aria-label="Search results"] [role=option]'),
];
export const status = () =>
  document.querySelector('[role=status].search-status')!.textContent ?? '';
export const advance = (b: Booted, ms: number) =>
  act(async () => void (await b.timers.advance(ms)));
export const runCalls = (env: Env) =>
  env.bridge.calls
    .filter((c) => c.method === 'search.run')
    .map((c) => c.args as Record<string, unknown>);
export const lastRun = (env: Env) => runCalls(env).at(-1)!;

/** Types the whole query in one go, lets the debounce elapse and waits for the results to settle. */
export async function search(b: Booted, q: string, settled?: () => boolean): Promise<void> {
  await typeInto(box(), q);
  await advance(b, 150);
  await waitFor(
    settled ?? (() => status() !== '' && b.model().search.get().status !== 'loading'),
    `results for ${q}`,
  );
}

/** Sets a <select>/<input> value the way React expects, then fires `change`. */
export async function choose(el: HTMLSelectElement | HTMLInputElement, v: string) {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
export const field = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('.search-filters label')]
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector<HTMLSelectElement & HTMLInputElement>('input, select') as HTMLSelectElement &
    HTMLInputElement;

/**
 * Wraps env.bridge so replies of chosen `search.run` calls (1-based call numbers) are delayed
 * until released: the reply of call 1 can then arrive AFTER call 2's.
 */
export function delayRuns(env: Env, which: number[]) {
  const inner: Bridge = env.bridge;
  const gates = new Map<number, () => void>();
  let n = 0;
  env.bridge = {
    ...env.bridge,
    calls: env.bridge.calls,
    count: env.bridge.count,
    hold: env.bridge.hold,
    inject: env.bridge.inject,
    emit: env.bridge.emit,
    async rpc(method: string, args?: unknown): Promise<RpcResult<unknown>> {
      if (method !== 'search.run') return inner.rpc(method, args);
      const mine = ++n;
      const r = await inner.rpc(method, args);
      if (which.includes(mine)) await new Promise<void>((res) => gates.set(mine, res));
      return r;
    },
  };
  return { release: (k: number) => act(async () => void gates.get(k)?.()) };
}
