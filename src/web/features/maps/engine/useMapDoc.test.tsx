// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook as renderPlainHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { MapShape } from '@shared/schemas/map';
import type { MapDetail, MapPin } from '@shared/types';
import { ToastProvider } from '../../../components/ui/Toast';
import * as toastModule from '../../../components/ui/Toast';
import { api, ApiError } from '../../../lib/api';
import { resetJournalState, setCurrentJournal } from '../../../lib/journal';
import { addShapes, makePin, moveObjects, type Doc } from './doc';
import { queryKeys } from '../../../lib/queryKeys';
import { readUnsaved, stashUnsaved } from './unsavedDrawing';
import { diffDoc, useMapDoc } from './useMapDoc';

/** The hook reads the query client, so every render gets one (a fresh cache per test). */
let client = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);
const renderHook = <T,>(hook: () => T) => renderPlainHook(hook, { wrapper });

const STYLE = { stroke: 'ink', fill: null, width: 3, dash: 'solid' } as const;
const rect = (id: string): MapShape => ({
  id,
  layer: 'layer-1',
  t: 'rect',
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  style: STYLE,
});
const emptyMap = (pins: MapPin[] = []): MapDetail => ({
  id: 'MAP',
  name: 'Map',
  pinCount: pins.length,
  createdAt: 'x',
  updatedAt: 'x',
  scene: { v: 2, layers: [{ id: 'layer-1', name: 'Layer 1' }], shapes: [] },
  pins,
});

let save: MockInstance<typeof api.saveMapChanges>;
beforeEach(() => {
  setCurrentJournal('journal');
  localStorage.clear();
  client = new QueryClient();
  vi.useFakeTimers();
  save = vi.spyOn(api, 'saveMapChanges').mockResolvedValue({ updatedAt: 'now' });
  vi.spyOn(api, 'saveMapChangesOnExit').mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  resetJournalState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('diffDoc', () => {
  const base: Doc = { scene: emptyMap().scene, pins: [] };
  it('is null when nothing changed', () => {
    expect(diffDoc(base, base)).toBeNull();
  });
  it('carries the scene when it changed, and only the markers that changed', () => {
    const a = makePin('MAP', 'A', 1, 1, 'layer-1');
    const b = makePin('MAP', 'B', 2, 2, 'layer-1');
    const before: Doc = { ...base, pins: [a, b] };
    const after: Doc = { scene: addShapes(base, [rect('r')]).scene, pins: [{ ...a, x: 9 }] };
    const d = diffDoc(before, after);
    expect(d?.scene?.shapes).toHaveLength(1);
    expect(d?.upsert?.map((p) => p.id)).toEqual(['A']);
    expect(d?.remove).toEqual(['B']);
  });

  describe('a marker link', () => {
    const linked = makePin('MAP', 'A', 1, 1, 'layer-1');
    const withLink = { ...linked, target: { type: 'person' as const, id: 'P', label: 'Linus' } };
    const docOf = (pin: MapPin): Doc => ({ ...base, pins: [pin] });

    it('is left out when only something else about the marker changed', () => {
      const d = diffDoc(docOf(withLink), docOf({ ...withLink, x: 9 }));
      expect(d?.upsert?.[0]).not.toHaveProperty('target');
      expect(d?.upsert?.[0]?.x).toBe(9);
    });

    it('is left out for a marker whose link the server hides, so the stored link survives', () => {
      const d = diffDoc(docOf(linked), docOf({ ...linked, x: 9 }));
      expect(d?.upsert?.[0]).not.toHaveProperty('target');
    });

    it('is sent as null when it was removed', () => {
      const d = diffDoc(docOf(withLink), docOf({ ...withLink, target: null }));
      expect(d?.upsert?.[0]).toHaveProperty('target', null);
    });

    it('is sent when it was added or pointed somewhere else', () => {
      const added = diffDoc(docOf(linked), docOf(withLink));
      expect(added?.upsert?.[0]?.target).toEqual({ type: 'person', id: 'P' });
      const other = { ...withLink, target: { type: 'note' as const, id: 'N', label: 'x' } };
      expect(diffDoc(docOf(withLink), docOf(other))?.upsert?.[0]?.target).toEqual({
        type: 'note',
        id: 'N',
      });
    });

    it('is sent with a new marker that has one, and left out when it has none', () => {
      const created = diffDoc(base, docOf(withLink));
      expect(created?.upsert?.[0]?.target).toEqual({ type: 'person', id: 'P' });
      expect(diffDoc(base, docOf(linked))?.upsert?.[0]).not.toHaveProperty('target');
    });
  });
});

describe('useMapDoc', () => {
  it('commits, undoes and redoes', () => {
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('a')]));
    });
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('b')]));
    });
    expect(result.current.doc.scene.shapes).toHaveLength(2);
    expect(result.current.canUndo).toBe(true);
    act(() => {
      result.current.undo();
    });
    expect(result.current.doc.scene.shapes).toHaveLength(1);
    expect(result.current.canRedo).toBe(true);
    act(() => {
      result.current.redo();
    });
    expect(result.current.doc.scene.shapes).toHaveLength(2);
    act(() => {
      result.current.undo();
      result.current.undo();
    });
    expect(result.current.doc.scene.shapes).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
  });

  it('a drag is one step: live edits between begin and end', () => {
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('a')]));
    });
    act(() => {
      result.current.begin();
      for (const dx of [5, 10, 20])
        result.current.live((d) => moveObjects(d, new Set(['a']), dx, 0));
      result.current.end();
    });
    expect((result.current.doc.scene.shapes[0] as { x: number }).x).toBe(35);
    act(() => {
      result.current.undo();
    });
    expect((result.current.doc.scene.shapes[0] as { x: number }).x).toBe(0);
  });

  it('cancel puts a drag back', () => {
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('a')]));
    });
    act(() => {
      result.current.begin();
      result.current.live((d) => moveObjects(d, new Set(['a']), 50, 0));
      result.current.cancel();
    });
    expect((result.current.doc.scene.shapes[0] as { x: number }).x).toBe(0);
    expect(result.current.canUndo).toBe(true); // only the first commit
  });

  it('joins quick edits that share a key into one undo step', () => {
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('a')]));
    });
    for (const dx of [1, 1, 1])
      act(() => {
        result.current.commit((d) => moveObjects(d, new Set(['a']), dx, 0), { coalesce: 'nudge' });
      });
    expect((result.current.doc.scene.shapes[0] as { x: number }).x).toBe(3);
    act(() => {
      result.current.undo();
    });
    expect((result.current.doc.scene.shapes[0] as { x: number }).x).toBe(0);
  });

  it('saves once after a pause, with only what changed', async () => {
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('a')]));
    });
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('b')]));
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.saveState).toBe('dirty');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(save).toHaveBeenCalledTimes(1);
    const body = save.mock.calls[0]?.[1] as { scene?: { shapes: unknown[] } };
    expect(body.scene?.shapes).toHaveLength(2);
    expect(result.current.saveState).toBe('saved');
  });

  it('reports a failed save and retries on demand', async () => {
    save.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('a')]));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(result.current.saveState).toBe('error');
    expect(result.current.saveError).toBe('nope');
    await act(async () => {
      await result.current.saveNow();
    });
    expect(result.current.saveState).toBe('saved');
  });

  it('undoing a marker removal saves it back', async () => {
    const pin = makePin('MAP', 'P', 1, 1, 'layer-1', { label: 'Gate' });
    const { result } = renderHook(() => useMapDoc(emptyMap([pin])));
    act(() => {
      result.current.commit((d) => ({ ...d, pins: [] }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect((save.mock.calls[0]?.[1] as { remove?: string[] }).remove).toEqual(['P']);
    act(() => {
      result.current.undo();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(
      (save.mock.calls[1]?.[1] as { upsert?: { id: string; label: string }[] }).upsert?.[0],
    ).toMatchObject({ id: 'P', label: 'Gate' });
  });

  it('replace loads a restored map and clears history', () => {
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('a')]));
    });
    act(() => {
      result.current.replace({
        ...emptyMap(),
        scene: { ...emptyMap().scene, shapes: [rect('x'), rect('y')] },
      });
    });
    expect(result.current.doc.scene.shapes).toHaveLength(2);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.saveState).toBe('saved');
  });
  it('writes what was drawn into the cached map when the editor closes, so reopening shows it', async () => {
    client.setQueryData(queryKeys.map('MAP'), emptyMap());
    const { result, unmount } = renderHook(() => useMapDoc(emptyMap()));
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('a')]));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    unmount();
    const cached = client.getQueryData<MapDetail>(queryKeys.map('MAP'));
    expect(cached?.scene.shapes).toHaveLength(1);
  });

  it('saves an unsaved change on close and still caches it', () => {
    client.setQueryData(queryKeys.map('MAP'), emptyMap());
    const { result, unmount } = renderHook(() => useMapDoc(emptyMap()));
    act(() => {
      result.current.commit((d) => addShapes(d, [rect('a')]));
    });
    unmount();
    expect(save).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<MapDetail>(queryKeys.map('MAP'))?.scene.shapes).toHaveLength(1);
  });
});

describe('useMapDoc and other windows', () => {
  const draw = (result: { current: ReturnType<typeof useMapDoc> }, id: string) => {
    act(() => {
      result.current.commit((d) => addShapes(d, [rect(id)]));
    });
  };
  const pause = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
  const newerMap = (): MapDetail => ({
    ...emptyMap(),
    updatedAt: 'theirs',
    scene: { ...emptyMap().scene, shapes: [rect('theirs')] },
  });
  const conflict = () =>
    new ApiError(409, {
      code: 'conflict',
      message: 'This map changed in another window.',
      details: { current: newerMap() },
    });
  const sentUpdatedAt = (call: number) =>
    (save.mock.calls[call]?.[1] as { expectedUpdatedAt?: string }).expectedUpdatedAt;

  it('sends the updatedAt it loaded with the first save', async () => {
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');

    await pause();

    expect(sentUpdatedAt(0)).toBe('x');
  });

  it('sends the updatedAt the previous save returned with the next one', async () => {
    save.mockResolvedValueOnce({ updatedAt: 'after-first' });
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');
    await pause();
    draw(result, 'b');

    await pause();

    expect(sentUpdatedAt(1)).toBe('after-first');
  });

  it('uses an updatedAt that another part of the page wrote to the cached map', async () => {
    client.setQueryData(queryKeys.map('MAP'), { ...emptyMap(), updatedAt: 'renamed' });
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');

    await pause();

    expect(sentUpdatedAt(0)).toBe('renamed');
  });

  it('stops saving and asks which copy to keep when another window changed the map', async () => {
    save.mockRejectedValueOnce(conflict());
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');
    await pause();

    draw(result, 'b');
    await pause();

    expect(result.current.saveState).toBe('conflict');
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.doc.scene.shapes).toHaveLength(2);
  });

  it('keeps my drawing by saving it over the newer copy', async () => {
    save.mockRejectedValueOnce(conflict());
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');
    await pause();

    await act(async () => {
      await result.current.keepMine();
    });

    expect(sentUpdatedAt(1)).toBe('theirs');
    expect(result.current.saveState).toBe('saved');
    expect(result.current.doc.scene.shapes.map((s) => s.id)).toEqual(['a']);
  });

  it('loads the newer copy instead of mine, and saves from it afterwards', async () => {
    save.mockRejectedValueOnce(conflict());
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');
    await pause();

    act(() => {
      result.current.reloadFromServer();
    });
    draw(result, 'b');
    await pause();

    expect(result.current.doc.scene.shapes.map((s) => s.id)).toEqual(['theirs', 'b']);
    expect(sentUpdatedAt(1)).toBe('theirs');
  });

  it('saves from the restored map after a version restore', async () => {
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    act(() => {
      result.current.replace(newerMap());
    });
    draw(result, 'b');

    await pause();

    expect(sentUpdatedAt(0)).toBe('theirs');
  });

  it('sends the updatedAt with the save made when the editor closes', () => {
    const { result, unmount } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');

    unmount();

    expect(sentUpdatedAt(0)).toBe('x');
  });

  it('does not send a closing save while a conflict is waiting for an answer', async () => {
    save.mockRejectedValueOnce(conflict());
    const { result, unmount } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');
    await pause();

    unmount();

    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('useMapDoc when the page is left', () => {
  const draw = (result: { current: ReturnType<typeof useMapDoc> }, id: string) => {
    act(() => {
      result.current.commit((d) => addShapes(d, [rect(id)]));
    });
  };
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  const manyShapes = (count: number): MapDetail => ({
    ...emptyMap(),
    scene: {
      ...emptyMap().scene,
      shapes: Array.from({ length: count }, (_, i) => rect(`s${i}`)),
    },
  });
  const unloadPage = () => {
    window.dispatchEvent(new Event('pagehide'));
  };
  const hideTab = () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  };

  it('remembers the updatedAt of the save made when the editor closes', async () => {
    save.mockResolvedValue({ updatedAt: 'after-close' });
    client.setQueryData(queryKeys.map('MAP'), emptyMap());
    const { result, unmount } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');

    unmount();
    await settle();

    expect(client.getQueryData<MapDetail>(queryKeys.map('MAP'))?.updatedAt).toBe('after-close');
  });

  it('keeps the drawing and says so when the save made on closing fails', async () => {
    save.mockRejectedValue(new Error('offline'));
    const show = vi.fn();
    vi.spyOn(toastModule, 'useToast').mockReturnValue({ show } as never);
    const { result, unmount } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');

    unmount();
    await settle();

    expect(readUnsaved('MAP')?.doc.scene.shapes).toHaveLength(1);
    expect((show.mock.calls[0]?.[0] as { message: string }).message).toMatch(
      /couldn't save your last changes/i,
    );
  });

  it('forgets the kept drawing once a save goes through', async () => {
    stashUnsaved('MAP', 'x', emptyMap());
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(readUnsaved('MAP')).toBeNull();
  });

  it('sends a small drawing over keepalive when the page unloads', () => {
    const onExit = vi.spyOn(api, 'saveMapChangesOnExit');
    const { result } = renderHook(() => useMapDoc(emptyMap()));
    draw(result, 'a');

    unloadPage();

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('keeps a drawing too large for keepalive instead of sending it when the page unloads', () => {
    const onExit = vi.spyOn(api, 'saveMapChangesOnExit');
    const { result } = renderHook(() => useMapDoc(manyShapes(600)));
    draw(result, 'extra');

    unloadPage();

    expect(onExit).not.toHaveBeenCalled();
    expect(readUnsaved('MAP')?.doc.scene.shapes).toHaveLength(601);
  });

  it('saves with an ordinary request when the tab is hidden', async () => {
    const { result } = renderHook(() => useMapDoc(manyShapes(600)));
    draw(result, 'extra');

    hideTab();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.saveState).toBe('saved');
  });

  it('puts back a kept drawing when the map is unchanged since, and saves it', async () => {
    stashUnsaved('MAP', 'x', manyShapes(3));
    const { result } = renderHook(() => useMapDoc(emptyMap()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(result.current.doc.scene.shapes).toHaveLength(3);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('asks which copy to keep when the map changed since the drawing was kept', () => {
    stashUnsaved('MAP', 'older', manyShapes(3));
    const { result } = renderHook(() => useMapDoc(emptyMap()));

    expect(result.current.saveState).toBe('conflict');
    expect(result.current.doc.scene.shapes).toHaveLength(3);
  });

  it('drops a kept drawing that is the same as the map', () => {
    stashUnsaved('MAP', 'x', emptyMap());
    const { result } = renderHook(() => useMapDoc(emptyMap()));

    expect(result.current.saveState).toBe('saved');
    expect(readUnsaved('MAP')).toBeNull();
  });
});
