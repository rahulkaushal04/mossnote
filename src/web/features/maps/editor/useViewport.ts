/** The canvas's size and view: measuring it, fitting the map on first show, zoom and pan. */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MapDetail } from '@shared/types';
import { contentBox, type Doc } from '../engine/doc';
import { fitView, zoomAt, type Size, type View } from '../geometry';

/** Zoom step for the buttons and + / - keys. */
const ZOOM_STEP = 1.25;

interface UseViewportOptions {
  map: MapDetail;
  /** A pin to centre on instead of fitting the whole map. */
  focusPin: string | null;
  docRef: RefObject<Doc>;
  /** Layout changes that resize the canvas element. */
  layout: { fullscreen: boolean; panelOpen: boolean; narrow: boolean };
}

export interface Viewport {
  wrap: RefObject<HTMLDivElement | null>;
  size: Size;
  view: View;
  setView: (next: View | ((v: View) => View)) => void;
  /** Go back to the fitted view (used after restoring a version). */
  clearOverride: () => void;
  /** Zoom about the centre by `factor`. */
  zoomBy: (factor: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitAll: () => void;
  resetZoom: () => void;
}

export function useViewport({ map, focusPin, docRef, layout }: UseViewportOptions): Viewport {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [override, setOverride] = useState<View | null>(null);
  const { fullscreen, panelOpen, narrow } = layout;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [fullscreen, panelOpen, narrow]);

  const sized = size.w > 0;
  const initialView = useMemo(() => {
    const target = focusPin ? map.pins.find((p) => p.id === focusPin) : undefined;
    if (target) return { cx: target.x, cy: target.y, scale: 1 };
    return fitView(contentBox({ scene: map.scene, pins: map.pins }, 20), size);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fit once, when the first size is known
  }, [sized, focusPin]);
  const view = override ?? initialView;

  const setView = useCallback(
    (next: View | ((v: View) => View)) => {
      setOverride((o) => {
        const base = o ?? initialView;
        return typeof next === 'function' ? next(base) : next;
      });
    },
    [initialView],
  );

  const zoomBy = (factor: number) => {
    setView((v) => zoomAt(v, size, size.w / 2, size.h / 2, factor));
  };

  return {
    wrap,
    size,
    view,
    setView,
    clearOverride: () => {
      setOverride(null);
    },
    zoomBy,
    zoomIn: () => {
      zoomBy(ZOOM_STEP);
    },
    zoomOut: () => {
      zoomBy(1 / ZOOM_STEP);
    },
    fitAll: () => {
      setView(fitView(contentBox(docRef.current, 20), size));
    },
    resetZoom: () => {
      setView((v) => ({ ...v, scale: 1 }));
    },
  };
}
