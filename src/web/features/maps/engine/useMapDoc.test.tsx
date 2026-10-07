// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { MapShape } from '@shared/schemas/map';
import type { MapDetail, MapPin } from '@shared/types';
import { api } from '../../../lib/api';
import { addShapes, makePin, moveObjects, type Doc } from './doc';
import { diffDoc, useMapDoc } from './useMapDoc';

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
  vi.useFakeTimers();
  save = vi.spyOn(api, 'saveMapChanges').mockResolvedValue({ updatedAt: 'now' });
  vi.spyOn(api, 'saveMapChangesOnExit').mockImplementation(() => undefined);
});
afterEach(() => {
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
});
