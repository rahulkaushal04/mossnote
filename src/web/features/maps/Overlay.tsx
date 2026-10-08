/**
 * Editing overlays drawn above the scene in screen space: grid, rulers, guides, selection frame,
 * handles and snap marks.
 */
import type { Guide } from './engine/snap';
import { gridStep } from './engine/snap';
import { useMediaQuery } from '../../lib/useViewport';
import { handleHitRadius } from './canvas/handleSize';
import { HANDLES, handlePoint, rotateHandlePoint, type Frame, type HandleId } from './engine/frame';
import { curveControl, type ObjInfo, type Objects, connectorGeometry } from './engine/shapes';
import type { MPt } from './engine/vec';
import { toScreen, type Size, type View } from './geometry';

const ACCENT = 'var(--accent)';

/** The optional grid, drawn as dots: small ones every step, larger ones every fifth. */
export function Grid({ view, size }: { view: View; size: Size }) {
  const step = gridStep(view.scale);
  const px = step * view.scale;
  const [ox, oy] = toScreen(view, size, 0, 0);
  const major = px * 5;
  // A dot sits at the centre of its pattern cell, so the cell starts half a step before the line.
  const x = ((ox % major) + major) % major;
  const y = ((oy % major) + major) % major;
  return (
    <g pointerEvents="none" aria-hidden="true">
      <defs>
        <pattern
          id="map-grid"
          x={x - px / 2}
          y={y - px / 2}
          width={px}
          height={px}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={px / 2} cy={px / 2} r={1} fill="var(--control)" opacity={0.55} />
        </pattern>
        <pattern
          id="map-grid-major"
          x={x - major / 2}
          y={y - major / 2}
          width={major}
          height={major}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={major / 2} cy={major / 2} r={1.75} fill="var(--ink-muted)" opacity={0.6} />
        </pattern>
      </defs>
      <rect width={size.w} height={size.h} fill="url(#map-grid)" />
      <rect width={size.w} height={size.h} fill="url(#map-grid-major)" />
    </g>
  );
}

export const RULER = 20;

/** Rulers along the top and left edge, in world units. */
export function Rulers({ view, size }: { view: View; size: Size }) {
  const step = gridStep(view.scale) * 5;
  const ticks = (axis: 'x' | 'y') => {
    const out: { pos: number; label: string }[] = [];
    const len = axis === 'x' ? size.w : size.h;
    const [wx0, wy0] = [view.cx - size.w / 2 / view.scale, view.cy - size.h / 2 / view.scale];
    const start = Math.floor((axis === 'x' ? wx0 : wy0) / step) * step;
    for (let v = start; ; v += step) {
      const [sx, sy] = toScreen(view, size, axis === 'x' ? v : 0, axis === 'y' ? v : 0);
      const s = axis === 'x' ? sx : sy;
      if (s > len) break;
      if (s >= RULER) out.push({ pos: s, label: String(Math.round(v)) });
    }
    return out;
  };
  return (
    <g aria-hidden="true" fontSize={10} fill="var(--ink-muted)" data-ruler>
      <rect width={size.w} height={RULER} fill="var(--raised)" data-ruler="x" />
      <rect width={RULER} height={size.h} fill="var(--raised)" data-ruler="y" />
      {ticks('x').map((t) => (
        <g key={`x${t.pos}`} pointerEvents="none">
          <line x1={t.pos} x2={t.pos} y1={RULER - 6} y2={RULER} stroke="var(--ink-muted)" />
          <text x={t.pos + 3} y={11}>
            {t.label}
          </text>
        </g>
      ))}
      {ticks('y').map((t) => (
        <g key={`y${t.pos}`} pointerEvents="none">
          <line y1={t.pos} y2={t.pos} x1={RULER - 6} x2={RULER} stroke="var(--ink-muted)" />
          <text transform={`translate(11 ${t.pos - 3}) rotate(-90)`}>{t.label}</text>
        </g>
      ))}
      <rect width={RULER} height={RULER} fill="var(--surface)" pointerEvents="none" />
    </g>
  );
}

export function GuideLines({
  guides,
  view,
  size,
}: {
  guides: readonly { axis: 'x' | 'y'; pos: number }[];
  view: View;
  size: Size;
}) {
  return (
    <g>
      {guides.map((g, i) => {
        const [sx, sy] = toScreen(view, size, g.pos, g.pos);
        return g.axis === 'x' ? (
          <g key={i} data-guide={i}>
            <line
              x1={sx}
              x2={sx}
              y1={0}
              y2={size.h}
              stroke="var(--map-sky)"
              strokeWidth={1}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
            <line
              x1={sx}
              x2={sx}
              y1={0}
              y2={size.h}
              stroke="transparent"
              strokeWidth={9}
              style={{ cursor: 'col-resize' }}
              data-guide={i}
            />
          </g>
        ) : (
          <g key={i} data-guide={i}>
            <line
              x1={0}
              x2={size.w}
              y1={sy}
              y2={sy}
              stroke="var(--map-sky)"
              strokeWidth={1}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
            <line
              x1={0}
              x2={size.w}
              y1={sy}
              y2={sy}
              stroke="transparent"
              strokeWidth={9}
              style={{ cursor: 'row-resize' }}
              data-guide={i}
            />
          </g>
        );
      })}
    </g>
  );
}

/** Lines drawn while snapping, so it is clear what lined up. */
export function SmartGuides({
  guides,
  view,
  size,
}: {
  guides: readonly Guide[];
  view: View;
  size: Size;
}) {
  return (
    <g pointerEvents="none" aria-hidden="true">
      {guides.map((g, i) => {
        const a =
          g.axis === 'x'
            ? toScreen(view, size, g.pos, g.from)
            : toScreen(view, size, g.from, g.pos);
        const b =
          g.axis === 'x' ? toScreen(view, size, g.pos, g.to) : toScreen(view, size, g.to, g.pos);
        return (
          <line
            key={i}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke="var(--map-rose)"
            strokeWidth={1}
            strokeDasharray="5 3"
          />
        );
      })}
    </g>
  );
}

export function SnapMark({ pt, view, size }: { pt: MPt; view: View; size: Size }) {
  const [x, y] = toScreen(view, size, pt[0], pt[1]);
  return (
    <g pointerEvents="none" aria-hidden="true">
      <circle cx={x} cy={y} r={7} fill="none" stroke="var(--map-rose)" strokeWidth={2} />
      <circle cx={x} cy={y} r={2} fill="var(--map-rose)" />
    </g>
  );
}

const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

export const ROTATE_OFFSET_PX = 26;

/**
 * A handle and its press target. The group carries the data attribute the canvas looks for, so a
 * press anywhere in the invisible circle grabs the handle. With a mouse the circle is not drawn.
 */
function Grab({
  at,
  attrs,
  cursor,
  children,
}: {
  at: readonly [number, number];
  attrs: Record<string, string | number | boolean>;
  cursor: string;
  children: React.ReactNode;
}) {
  const coarse = useMediaQuery('(pointer: coarse)');
  return (
    <g {...attrs} style={{ cursor }}>
      {coarse ? (
        <circle cx={at[0]} cy={at[1]} r={handleHitRadius(true)} fill="transparent" />
      ) : null}
      {children}
    </g>
  );
}

/** The frame round the selection, with eight resize handles and a turn handle. */
export function SelectionFrame({
  frame,
  view,
  size,
  canRotate,
  resizable,
}: {
  frame: Frame;
  view: View;
  size: Size;
  canRotate: boolean;
  resizable: boolean;
}) {
  const at = (p: MPt) => toScreen(view, size, p[0], p[1]);
  const corners = (['nw', 'ne', 'se', 'sw'] as const).map((h) => at(handlePoint(frame, h)));
  const poly = corners.map((c) => c.join(',')).join(' ');
  const rot = at(rotateHandlePoint(frame, ROTATE_OFFSET_PX / view.scale));
  const top = at(handlePoint(frame, 'n'));
  return (
    <g>
      <polygon
        points={poly}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1.5}
        strokeDasharray="5 3"
        pointerEvents="none"
      />
      {resizable
        ? HANDLES.map((h) => {
            const [x, y] = at(handlePoint(frame, h));
            return (
              <Grab key={h} at={[x, y]} attrs={{ 'data-handle': h }} cursor={HANDLE_CURSOR[h]}>
                <rect
                  x={x - 5}
                  y={y - 5}
                  width={10}
                  height={10}
                  rx={2}
                  fill="var(--raised)"
                  stroke={ACCENT}
                  strokeWidth={1.75}
                />
              </Grab>
            );
          })
        : null}
      {canRotate ? (
        <g>
          <line
            x1={top[0]}
            y1={top[1]}
            x2={rot[0]}
            y2={rot[1]}
            stroke={ACCENT}
            strokeWidth={1.5}
            pointerEvents="none"
          />
          <Grab at={rot} attrs={{ 'data-handle': 'rotate' }} cursor="grab">
            <circle
              cx={rot[0]}
              cy={rot[1]}
              r={6}
              fill="var(--raised)"
              stroke={ACCENT}
              strokeWidth={1.75}
            />
          </Grab>
        </g>
      ) : null}
    </g>
  );
}

/** Handles for the corners of a polygon or path, and the ends and bend of a connector. */
export function VertexHandles({
  info,
  objs,
  view,
  size,
}: {
  info: ObjInfo;
  objs: Objects;
  view: View;
  size: Size;
}) {
  const shape = info.shape;
  if (!shape) return null;
  const at = (p: MPt) => toScreen(view, size, p[0], p[1]);
  if (shape.t === 'polygon' || (shape.t === 'path' && shape.pts.length <= 60)) {
    return (
      <g>
        {shape.pts.map((p, i) => {
          const [x, y] = at([p[0], p[1]]);
          return (
            <Grab key={i} at={[x, y]} attrs={{ 'data-vertex': i }} cursor="move">
              <circle cx={x} cy={y} r={5} fill="var(--raised)" stroke={ACCENT} strokeWidth={1.75} />
            </Grab>
          );
        })}
      </g>
    );
  }
  if (shape.t === 'connector') {
    const g = connectorGeometry(shape, objs);
    const [ax, ay] = at(g.start.pt);
    const [bx, by] = at(g.end.pt);
    const ctrl = shape.route === 'curve' ? at(curveControl(shape, objs)) : null;
    return (
      <g>
        <Grab at={[ax, ay]} attrs={{ 'data-vertex': 'from' }} cursor="crosshair">
          <circle
            cx={ax}
            cy={ay}
            r={6}
            fill={shape.from.ref ? ACCENT : 'var(--raised)'}
            stroke={ACCENT}
            strokeWidth={1.75}
          />
        </Grab>
        <Grab at={[bx, by]} attrs={{ 'data-vertex': 'to' }} cursor="crosshair">
          <circle
            cx={bx}
            cy={by}
            r={6}
            fill={shape.to.ref ? ACCENT : 'var(--raised)'}
            stroke={ACCENT}
            strokeWidth={1.75}
          />
        </Grab>
        {ctrl ? (
          <Grab at={ctrl} attrs={{ 'data-bend': true }} cursor="move">
            <circle
              cx={ctrl[0]}
              cy={ctrl[1]}
              r={5}
              fill="var(--raised)"
              stroke={ACCENT}
              strokeWidth={1.75}
            />
          </Grab>
        ) : null}
      </g>
    );
  }
  return null;
}

/** Selected markers get a ring, not a frame: a marker has no size to change, and handles would cover it. */
export function PinRings({
  infos,
  view,
  size,
}: {
  infos: readonly ObjInfo[];
  view: View;
  size: Size;
}) {
  return (
    <g pointerEvents="none" aria-hidden="true">
      {infos.map((i) => {
        const [x, y] = toScreen(view, size, i.center[0], i.center[1]);
        return (
          <circle
            key={i.id}
            cx={x}
            cy={y}
            r={19}
            fill="none"
            stroke={ACCENT}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        );
      })}
    </g>
  );
}
