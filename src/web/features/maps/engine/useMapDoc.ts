/**
 * The document store for the editor: current doc, undo and redo with coalesced edits, live drags,
 * and autosave (debounced, plus a keepalive save when the page is hidden).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MapChanges } from '@shared/schemas/map';
import type { MapDetail, MapPin } from '@shared/types';
import { useToast } from '../../../components/ui/Toast';
import { api, ApiError } from '../../../lib/api';
import { queryKeys } from '../../../lib/queryKeys';
import { refreshMaps } from '../hooks';
import type { Doc } from './doc';
import { clearUnsaved, fitsExitRequest, readUnsaved, stashUnsaved } from './unsavedDrawing';

const HISTORY_LIMIT = 100;
const SAVE_DELAY = 600;
const COALESCE_MS = 900;

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error' | 'conflict';

const pinPayload = (p: MapPin) => ({
  id: p.id,
  x: p.x,
  y: p.y,
  label: p.label,
  color: p.color,
  note: p.note,
  props: p.props,
  target: p.target ? { type: p.target.type, id: p.target.id } : null,
});

/** What differs between what the server has and what is on screen, as one request body. */
export function diffDoc(saved: Doc, now: Doc): MapChanges | null {
  const changes: MapChanges = {};
  if (saved.scene !== now.scene) changes.scene = now.scene;
  const before = new Map(saved.pins.map((p) => [p.id, p]));
  const upsert = now.pins.filter((p) => before.get(p.id) !== p).map(pinPayload);
  const remove = saved.pins.filter((p) => !now.pins.some((q) => q.id === p.id)).map((p) => p.id);
  if (upsert.length > 0) changes.upsert = upsert;
  if (remove.length > 0) changes.remove = remove;
  return Object.keys(changes).length > 0 ? changes : null;
}

const sameDoc = (a: Doc, b: Doc): boolean =>
  JSON.stringify(a.scene) === JSON.stringify(b.scene) &&
  JSON.stringify(a.pins.map(pinPayload)) === JSON.stringify(b.pins.map(pinPayload));

/** What a drawing kept from an earlier visit means now: save it again, or ask which copy to keep. */
function recoverUnsaved(map: MapDetail, server: Doc): { doc: Doc; conflict: boolean } | null {
  const kept = readUnsaved(map.id);
  if (!kept) return null;
  if (sameDoc(kept.doc, server)) {
    clearUnsaved(map.id);
    return null;
  }
  return { doc: kept.doc, conflict: kept.updatedAt !== map.updatedAt };
}

/**
 * The map being edited: the document, undo and redo, and saving. Edits are made with `commit` (one
 * undo step), or `live` while dragging with `begin` and `end` around it, so a drag is one step.
 * Everything is saved a moment after the last change, in one request, and again if the page is
 * closed in between.
 */
export function useMapDoc(map: MapDetail) {
  const client = useQueryClient();
  const toast = useToast();
  const initial = useMemo<Doc>(() => ({ scene: map.scene, pins: map.pins }), [map]);
  const [kept] = useState(() => recoverUnsaved(map, initial));
  const [doc, setDoc] = useState<Doc>(kept?.doc ?? initial);
  const docRef = useRef(doc);
  const saved = useRef<Doc>(initial);
  const past = useRef<Doc[]>([]);
  const future = useRef<Doc[]>([]);
  const base = useRef<Doc | null>(null);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const [state, setState] = useState<SaveState>(
    kept ? (kept.conflict ? 'conflict' : 'dirty') : 'saved',
  );
  const [error, setError] = useState<string | null>(null);
  /** The map as another window saved it, while this window waits to be told which copy to keep. */
  const newer = useRef<MapDetail | null>(kept?.conflict ? map : null);
  const loadedAt = useRef(map.updatedAt);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  /** True once this visit has written anything, so leaving refreshes the lists that show it. */
  const wrote = useRef(false);

  /** The cache is shared with the page's other writers (a rename), so it wins over `loadedAt`. */
  const expectedUpdatedAt = useCallback(
    () => client.getQueryData<MapDetail>(queryKeys.map(map.id))?.updatedAt ?? loadedAt.current,
    [client, map.id],
  );

  const rememberUpdatedAt = useCallback(
    (updatedAt: string) => {
      loadedAt.current = updatedAt;
      client.setQueryData<MapDetail>(queryKeys.map(map.id), (old) =>
        old ? { ...old, updatedAt } : old,
      );
    },
    [client, map.id],
  );

  const syncDepth = () => {
    setDepth({ past: past.current.length, future: future.current.length });
  };

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    chain.current = chain.current.then(async () => {
      if (newer.current) return;
      const target = docRef.current;
      const changes = diffDoc(saved.current, target);
      if (!changes) {
        setState('saved');
        return;
      }
      setState('saving');
      try {
        const result = await api.saveMapChanges(map.id, {
          ...changes,
          expectedUpdatedAt: expectedUpdatedAt(),
        });
        rememberUpdatedAt(result.updatedAt);
        saved.current = target;
        clearUnsaved(map.id);
        wrote.current = true;
        setError(null);
        setState(docRef.current === target ? 'saved' : 'dirty');
      } catch (e) {
        const theirs = e instanceof ApiError && e.code === 'conflict' ? e.details?.current : null;
        if (theirs) {
          newer.current = theirs as MapDetail;
          setState('conflict');
          return;
        }
        setError(e instanceof Error ? e.message : "Couldn't save that change.");
        setState('error');
      }
    });
    return chain.current;
  }, [map.id, expectedUpdatedAt, rememberUpdatedAt]);

  const schedule = useCallback(() => {
    if (newer.current) return;
    setState((s) => (s === 'saving' ? s : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
  }, [flush]);

  const apply = useCallback(
    (next: Doc) => {
      docRef.current = next;
      setDoc(next);
      schedule();
    },
    [schedule],
  );

  const pushPast = useCallback((d: Doc) => {
    past.current = [...past.current, d].slice(-HISTORY_LIMIT);
    future.current = [];
    setDepth({ past: past.current.length, future: 0 });
  }, []);

  /** One undoable edit. Edits with the same `coalesce` key in quick succession share a step. */
  const commit = useCallback(
    (fn: Doc | ((d: Doc) => Doc), options: { coalesce?: string } = {}) => {
      const current = docRef.current;
      const next = typeof fn === 'function' ? fn(current) : fn;
      if (next === current) return;
      const now = Date.now();
      const last = lastKey.current;
      const joins =
        options.coalesce !== undefined &&
        last?.key === options.coalesce &&
        now - last.at < COALESCE_MS;
      if (!joins) pushPast(current);
      lastKey.current = options.coalesce === undefined ? null : { key: options.coalesce, at: now };
      apply(next);
    },
    [apply, pushPast],
  );

  /** Change the document during a drag without adding history; pair with begin and end. */
  const live = useCallback(
    (fn: (d: Doc) => Doc) => {
      const next = fn(docRef.current);
      if (next !== docRef.current) apply(next);
    },
    [apply],
  );
  const begin = useCallback(() => {
    base.current = docRef.current;
  }, []);
  const end = useCallback(() => {
    const b = base.current;
    base.current = null;
    if (b && b !== docRef.current) pushPast(b);
    lastKey.current = null;
  }, [pushPast]);
  /** Abandon a drag: put the document back as `begin` found it. */
  const cancel = useCallback(() => {
    const b = base.current;
    base.current = null;
    if (b) apply(b);
  }, [apply]);

  const undo = useCallback(() => {
    const prev = past.current.at(-1);
    if (!prev) return;
    future.current = [docRef.current, ...future.current];
    past.current = past.current.slice(0, -1);
    lastKey.current = null;
    apply(prev);
    syncDepth();
  }, [apply]);
  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    past.current = [...past.current, docRef.current];
    future.current = future.current.slice(1);
    lastKey.current = null;
    apply(next);
    syncDepth();
  }, [apply]);

  /** Load a map from the server (a restored version): history starts again. */
  const replace = useCallback(
    (detail: MapDetail) => {
      const next = { scene: detail.scene, pins: detail.pins };
      clearTimeout(timer.current);
      newer.current = null;
      clearUnsaved(map.id);
      rememberUpdatedAt(detail.updatedAt);
      saved.current = next;
      docRef.current = next;
      past.current = [];
      future.current = [];
      setDoc(next);
      setDepth({ past: 0, future: 0 });
      setState('saved');
      setError(null);
    },
    [map.id, rememberUpdatedAt],
  );

  /** Take the other window's copy and drop what this window drew since. */
  const reloadFromServer = useCallback(() => {
    if (newer.current) replace(newer.current);
  }, [replace]);

  /** Save this window's drawing over the other window's copy. */
  const keepMine = useCallback(async () => {
    if (!newer.current) return;
    rememberUpdatedAt(newer.current.updatedAt);
    newer.current = null;
    setState('dirty');
    await flush();
  }, [flush, rememberUpdatedAt]);

  useEffect(() => {
    if (!kept || kept.conflict) return;
    toast.show({ message: 'Brought back the changes you made before leaving this map.' });
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    // once per visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving inside the save delay must not lose the last change.
  useEffect(() => {
    const onUnload = () => {
      const changes = diffDoc(saved.current, docRef.current);
      if (!changes || newer.current) return;
      const request = { ...changes, expectedUpdatedAt: expectedUpdatedAt() };
      if (fitsExitRequest(request)) {
        saved.current = docRef.current;
        void api.saveMapChangesOnExit(map.id, request);
      } else {
        stashUnsaved(map.id, request.expectedUpdatedAt, docRef.current);
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('pagehide', onUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onUnload);
      document.removeEventListener('visibilitychange', onHide);
      // Leaving the editor (navigating inside the app) saves at once.
      const changes = diffDoc(saved.current, docRef.current);
      clearTimeout(timer.current);
      if (newer.current) {
        // the unsaved drawing was never accepted, so the next visit loads the server's copy
        void client.invalidateQueries({ queryKey: queryKeys.map(map.id) });
        return;
      }
      // The map is cached for the editor's own use and never refetched, so what was drawn here must
      // be written into the cache, or reopening the map would show the copy fetched before the edits
      // and the next save would overwrite the real drawing with it.
      const target = docRef.current;
      client.setQueryData<MapDetail>(queryKeys.map(map.id), (old) =>
        old
          ? { ...old, scene: target.scene, pins: target.pins, pinCount: target.pins.length }
          : old,
      );
      if (changes) {
        saved.current = target;
        const expected = expectedUpdatedAt();
        api.saveMapChanges(map.id, { ...changes, expectedUpdatedAt: expected }).then(
          (result) => {
            rememberUpdatedAt(result.updatedAt);
            clearUnsaved(map.id);
            return refreshMaps(client);
          },
          () => {
            stashUnsaved(map.id, expected, target);
            void client.invalidateQueries({ queryKey: queryKeys.map(map.id) });
            toast.show({
              message:
                "Couldn't save your last changes to the map. They come back when you reopen it.",
              tone: 'alert',
            });
          },
        );
      } else if (wrote.current) {
        void refreshMaps(client);
      }
    };
  }, [map.id, client, toast, flush, expectedUpdatedAt, rememberUpdatedAt]);

  return {
    doc,
    docRef,
    commit,
    live,
    begin,
    end,
    cancel,
    undo,
    redo,
    canUndo: depth.past > 0,
    canRedo: depth.future > 0,
    replace,
    reloadFromServer,
    keepMine,
    saveNow: flush,
    saveState: state,
    saveError: error,
  };
}
