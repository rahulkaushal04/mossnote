/**
 * The document store for the editor: current doc, undo and redo with coalesced edits, live drags,
 * and autosave (debounced, plus a keepalive save when the page is hidden).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MapChanges } from '@shared/schemas/map';
import type { MapDetail, MapPin } from '@shared/types';
import { api } from '../../../lib/api';
import { queryKeys } from '../../../lib/queryKeys';
import { refreshMaps } from '../hooks';
import type { Doc } from './doc';

const HISTORY_LIMIT = 100;
const SAVE_DELAY = 600;
const COALESCE_MS = 900;

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

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

/**
 * The map being edited: the document, undo and redo, and saving. Edits are made with `commit` (one
 * undo step), or `live` while dragging with `begin` and `end` around it, so a drag is one step.
 * Everything is saved a moment after the last change, in one request, and again if the page is
 * closed in between.
 */
export function useMapDoc(map: MapDetail) {
  const client = useQueryClient();
  const initial = useMemo<Doc>(() => ({ scene: map.scene, pins: map.pins }), [map]);
  const [doc, setDoc] = useState<Doc>(initial);
  const docRef = useRef(doc);
  const saved = useRef<Doc>(initial);
  const past = useRef<Doc[]>([]);
  const future = useRef<Doc[]>([]);
  const base = useRef<Doc | null>(null);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const [state, setState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  /** True once this visit has written anything, so leaving refreshes the lists that show it. */
  const wrote = useRef(false);

  const syncDepth = () => {
    setDepth({ past: past.current.length, future: future.current.length });
  };

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    chain.current = chain.current.then(async () => {
      const target = docRef.current;
      const changes = diffDoc(saved.current, target);
      if (!changes) {
        setState('saved');
        return;
      }
      setState('saving');
      try {
        await api.saveMapChanges(map.id, changes);
        saved.current = target;
        wrote.current = true;
        setError(null);
        setState(docRef.current === target ? 'saved' : 'dirty');
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save that change.");
        setState('error');
      }
    });
    return chain.current;
  }, [map.id]);

  const schedule = useCallback(() => {
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
  const replace = useCallback((detail: MapDetail) => {
    const next = { scene: detail.scene, pins: detail.pins };
    clearTimeout(timer.current);
    saved.current = next;
    docRef.current = next;
    past.current = [];
    future.current = [];
    setDoc(next);
    setDepth({ past: 0, future: 0 });
    setState('saved');
    setError(null);
  }, []);

  // Closing or reloading inside the save delay must not lose the last change.
  useEffect(() => {
    const onExit = () => {
      const changes = diffDoc(saved.current, docRef.current);
      if (changes) {
        saved.current = docRef.current;
        void api.saveMapChangesOnExit(map.id, changes);
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') onExit();
    };
    window.addEventListener('pagehide', onExit);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onExit);
      document.removeEventListener('visibilitychange', onHide);
      // Leaving the editor (navigating inside the app) saves at once.
      const changes = diffDoc(saved.current, docRef.current);
      clearTimeout(timer.current);
      // The map is cached for the editor's own use and never refetched, so what was drawn here must
      // be written into the cache, or reopening the map would show the copy fetched before the edits
      // and the next save would overwrite the real drawing with it.
      const { scene, pins } = docRef.current;
      client.setQueryData<MapDetail>(queryKeys.map(map.id), (old) =>
        old ? { ...old, scene, pins, pinCount: pins.length } : old,
      );
      if (changes) {
        saved.current = docRef.current;
        // The lists (Maps, Places, search) are refreshed once the server has the last change.
        void api.saveMapChangesOnExit(map.id, changes).then(() => refreshMaps(client));
      } else if (wrote.current) {
        void refreshMaps(client);
      }
    };
  }, [map.id, client]);

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
    saveNow: flush,
    saveState: state,
    saveError: error,
  };
}
