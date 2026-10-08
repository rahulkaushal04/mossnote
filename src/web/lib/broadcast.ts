import type { QueryClient } from '@tanstack/react-query';

type Keys = readonly (readonly unknown[])[];

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('moss');

/**
 * After a successful mutation, tell other open windows which queries to refetch. With refetch on
 * focus this keeps two windows in step without a sync layer.
 */
export function broadcastInvalidate(keys: Keys): void {
  try {
    channel?.postMessage({ type: 'invalidate', keys });
  } catch {
    // A closed channel only means other windows catch up on focus.
  }
}

/** Invalidate locally and in every other window. */
export function invalidateEverywhere(client: QueryClient, keys: Keys): Promise<unknown> {
  broadcastInvalidate(keys);
  return Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}

/** Tell the other open windows that this one switched journals, so they stop writing to the old one. */
export function broadcastJournalSwitched(id: string | null): void {
  try {
    channel?.postMessage({ type: 'journal', id });
  } catch {
    // A window that misses this is told by the server on its next request.
  }
}

/** Listen for a journal switch in another window. Returns a cleanup function. */
export function listenForJournalSwitch(onSwitch: (id: string | null) => void): () => void {
  if (!channel) return () => undefined;
  const onMessage = (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: string; id?: string | null } | null;
    if (data?.type === 'journal') onSwitch(data.id ?? null);
  };
  channel.addEventListener('message', onMessage);
  return () => {
    channel.removeEventListener('message', onMessage);
  };
}

/** Listen for invalidations from other windows. Returns a cleanup function. */
export function listenForInvalidations(client: QueryClient): () => void {
  if (!channel) return () => undefined;
  const onMessage = (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: string; keys?: Keys } | null;
    if (data?.type !== 'invalidate' || !Array.isArray(data.keys)) return;
    for (const queryKey of data.keys as Keys) void client.invalidateQueries({ queryKey });
  };
  channel.addEventListener('message', onMessage);
  return () => {
    channel.removeEventListener('message', onMessage);
  };
}
