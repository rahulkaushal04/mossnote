/** Overlays drawn above the scene while a gesture is under way. */
import type { Doc } from '../engine/doc';
import { angleOf, dist, type MPt } from '../engine/vec';
import { toScreen, type Size, type View } from '../geometry';

interface ScreenProps {
  view: View;
  size: Size;
}

/** The box dragged out to select several objects. */
export function Marquee({ a, b, view, size }: ScreenProps & { a: MPt; b: MPt }) {
  const [x1, y1] = toScreen(view, size, a[0], a[1]);
  const [x2, y2] = toScreen(view, size, b[0], b[1]);
  return (
    <rect
      x={Math.min(x1, x2)}
      y={Math.min(y1, y2)}
      width={Math.abs(x2 - x1)}
      height={Math.abs(y2 - y1)}
      fill="var(--accent)"
      fillOpacity={0.1}
      stroke="var(--accent)"
      strokeWidth={1}
      pointerEvents="none"
    />
  );
}

/** The line, distance and angle shown by the Measure tool. Uses the map's scale if it has one. */
export function Measure({ a, b, view, size, doc }: ScreenProps & { a: MPt; b: MPt; doc: Doc }) {
  const [x1, y1] = toScreen(view, size, a[0], a[1]);
  const [x2, y2] = toScreen(view, size, b[0], b[1]);
  const length = dist(a, b);
  const scale = doc.scene.scale;
  const value = scale
    ? (length / scale.size).toFixed(length / scale.size < 10 ? 1 : 0)
    : String(Math.round(length));
  const unit = scale ? ` ${scale.unit}` : '';
  const angle = Math.round((angleOf(a, b) * 180) / Math.PI);
  return (
    <g pointerEvents="none">
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--map-amber)"
        strokeWidth={2}
        strokeDasharray="6 4"
      />
      <circle cx={x1} cy={y1} r={4} fill="var(--map-amber)" />
      <circle cx={x2} cy={y2} r={4} fill="var(--map-amber)" />
      <g transform={`translate(${(x1 + x2) / 2} ${(y1 + y2) / 2 - 12})`}>
        <rect
          x={-46}
          y={-14}
          width={92}
          height={22}
          rx={6}
          fill="var(--raised)"
          stroke="var(--map-amber)"
        />
        <text textAnchor="middle" y={2} fontSize={12} fill="var(--ink)">
          {value}
          {unit} · {angle}°
        </text>
      </g>
    </g>
  );
}
