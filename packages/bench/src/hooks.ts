import type { Dispatcher, Workspace } from '../../core/src/index.ts';

/** What a module's metric receives: a warm workspace and dispatcher on a private copy of the dataset. */
export interface MetricContext {
  ws: Workspace;
  dispatcher: Dispatcher;
  size: number;
}

/** PB-7: other modules (LK-7, PT-13, AI-8 ...) register a latency metric and it reports with the rest. */
export interface MetricHook {
  /** Unique id, for example `links.backlinks`. */
  id: string;
  title: string;
  /** Optional provisional target for the p95 in ms; absent means "measured, no verdict". */
  targetP95Ms?: number;
  /** Returns one sample in ms per repetition. Called `reps` times (at least 30). */
  run(ctx: MetricContext, rep: number): Promise<number> | number;
}

const hooks = new Map<string, MetricHook>();

export function registerMetric(h: MetricHook): void {
  if (hooks.has(h.id)) throw new Error(`metric already registered: ${h.id}`);
  hooks.set(h.id, h);
}
export const registeredMetrics = (): MetricHook[] => [...hooks.values()];
export const clearMetrics = (): void => hooks.clear();
