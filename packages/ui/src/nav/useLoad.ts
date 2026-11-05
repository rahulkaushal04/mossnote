import { useCallback, useEffect, useRef, useState } from 'react';
import type { RpcResult } from '@mossnote/core/rpc';
import type { Client } from '../rpc/client';

type Entity = 'note' | 'folder' | 'tag' | 'trash';
export interface Loaded<T> {
  status: 'loading' | 'ready' | 'error';
  data?: T;
  error?: string;
  reload(): Promise<void>;
}

/**
 * Loads once, then reloads on every structural `changed` event for `entities` (autosave events,
 * `content: true`, are ignored). A slower older reply never overwrites a newer one.
 */
export function useLoad<T>(
  client: Client,
  call: () => Promise<RpcResult<T>>,
  entities: Entity[],
): Loaded<T> {
  const [st, setSt] = useState<{ status: Loaded<T>['status']; data?: T; error?: string }>({
    status: 'loading',
  });
  const callRef = useRef(call);
  callRef.current = call;
  const seq = useRef(0);
  const alive = useRef(true);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const r = await callRef.current();
    if (!alive.current || mine !== seq.current) return;
    setSt(
      r.ok
        ? { status: 'ready', data: r.value }
        : { status: 'error', error: r.error.message, data: undefined },
    );
  }, []);
  const key = entities.join(',');
  useEffect(() => {
    alive.current = true;
    void reload();
    const off = client.onEvent((e) => {
      if (e.type === 'changed' && !e.content && key.split(',').includes(e.entity)) void reload();
    });
    return () => {
      alive.current = false;
      off();
    };
  }, [client, key, reload]);
  return { ...st, reload };
}
