/**
 * The overview map: the whole drawing in miniature with the current view outlined; click to jump.
 */
import { useMemo, useRef } from 'react';
import { isVisible, type Doc } from './engine/doc';
import type { Objects } from './engine/shapes';
import { inflate, unionBox, type Box } from './engine/vec';
import { visibleBox, type Size, type View } from './geometry';
import { cssColor } from './render/colors';

const W = 168;
const H = 112;

/** A small overview of the whole map. Click or drag in it to move the main view. */
export function Minimap({
  doc,
  objs,
  view,
  size,
  onGo,
}: {
  doc: Doc;
  objs: Objects;
  view: View;
  size: Size;
  onGo: (cx: number, cy: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const vis = visibleBox(view, size);
  const { box, items } = useMemo(() => {
    let all: Box | null = null;
    const out: { id: string; box: Box; color: string; pin: boolean }[] = [];
    for (const info of objs.values()) {
      if (!isVisible(doc, info)) continue;
      all = unionBox(all, info.box);
      const color =
        info.kind === 'pin'
          ? cssColor(info.pin?.color ?? 'moss')
          : cssColor(info.shape?.style.stroke ?? 'ink');
      out.push({ id: info.id, box: info.box, color, pin: info.kind === 'pin' });
    }
    return { box: all, items: out };
  }, [doc, objs]);

  const world = inflate(unionBox(box, vis) ?? vis, 60);
  const k = Math.min(W / (world.maxX - world.minX), H / (world.maxY - world.minY));
  const ox = (W - (world.maxX - world.minX) * k) / 2;
  const oy = (H - (world.maxY - world.minY) * k) / 2;
  const sx = (x: number) => (x - world.minX) * k + ox;
  const sy = (y: number) => (y - world.minY) * k + oy;

  const go = (e: React.PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    onGo((e.clientX - r.left - ox) / k + world.minX, (e.clientY - r.top - oy) / k + world.minY);
  };

  return (
    <svg
      ref={svg}
      width={W}
      height={H}
      role="img"
      aria-label="Overview of the whole map. Click to move there."
      className="touch-none rounded-control border border-rule bg-raised shadow-float"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        go(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) go(e);
      }}
    >
      {items.map((it) =>
        it.pin ? (
          <circle key={it.id} cx={sx(it.box.minX)} cy={sy(it.box.minY)} r={3} fill={it.color} />
        ) : (
          <rect
            key={it.id}
            x={sx(it.box.minX)}
            y={sy(it.box.minY)}
            width={Math.max(1.5, (it.box.maxX - it.box.minX) * k)}
            height={Math.max(1.5, (it.box.maxY - it.box.minY) * k)}
            fill={it.color}
            opacity={0.55}
          />
        ),
      )}
      <rect
        x={sx(vis.minX)}
        y={sy(vis.minY)}
        width={(vis.maxX - vis.minX) * k}
        height={(vis.maxY - vis.minY) * k}
        fill="var(--accent)"
        fillOpacity={0.12}
        stroke="var(--accent)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
