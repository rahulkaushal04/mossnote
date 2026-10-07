/**
 * Align and distribute: how far each object (or group, as one unit) must move to line up or space
 * out. Pure; `doc` applies the moves.
 */
import type { Box } from './vec';

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface Unit {
  /** Ids that move together (a group moves as one). */
  ids: string[];
  box: Box;
}

export type Deltas = Map<string, [number, number]>;

const union = (units: Unit[]): Box => ({
  minX: Math.min(...units.map((u) => u.box.minX)),
  minY: Math.min(...units.map((u) => u.box.minY)),
  maxX: Math.max(...units.map((u) => u.box.maxX)),
  maxY: Math.max(...units.map((u) => u.box.maxY)),
});

const set = (out: Deltas, unit: Unit, dx: number, dy: number) => {
  if (dx === 0 && dy === 0) return;
  for (const id of unit.ids) out.set(id, [dx, dy]);
};

/** Move each unit so they share an edge or a centre line of the whole selection. */
export function alignDeltas(units: Unit[], kind: AlignKind): Deltas {
  const out: Deltas = new Map();
  if (units.length < 2) return out;
  const all = union(units);
  for (const u of units) {
    const b = u.box;
    switch (kind) {
      case 'left':
        set(out, u, all.minX - b.minX, 0);
        break;
      case 'right':
        set(out, u, all.maxX - b.maxX, 0);
        break;
      case 'hcenter':
        set(out, u, (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2, 0);
        break;
      case 'top':
        set(out, u, 0, all.minY - b.minY);
        break;
      case 'bottom':
        set(out, u, 0, all.maxY - b.maxY);
        break;
      case 'vcenter':
        set(out, u, 0, (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2);
        break;
    }
  }
  return out;
}

/** Space units so the gaps between them are equal; the two outermost stay where they are. */
export function distributeDeltas(units: Unit[], axis: 'h' | 'v'): Deltas {
  const out: Deltas = new Map();
  if (units.length < 3) return out;
  const lo = (u: Unit) => (axis === 'h' ? u.box.minX : u.box.minY);
  const hi = (u: Unit) => (axis === 'h' ? u.box.maxX : u.box.maxY);
  const sorted = [...units].sort((a, b) => lo(a) - lo(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return out;
  const total = hi(last) - lo(first);
  const sizes = sorted.reduce((sum, u) => sum + (hi(u) - lo(u)), 0);
  const gap = (total - sizes) / (sorted.length - 1);
  let cursor = lo(first);
  for (const u of sorted) {
    const d = cursor - lo(u);
    set(out, u, axis === 'h' ? d : 0, axis === 'v' ? d : 0);
    cursor += hi(u) - lo(u) + gap;
  }
  return out;
}

/** Make every unit the same size as the first: width, height, or both. */
export function sameSizeScales(units: Unit[], mode: 'w' | 'h'): Map<string, number> {
  const out = new Map<string, number>();
  const ref = units[0];
  if (!ref || units.length < 2) return out;
  const size = (u: Unit) => (mode === 'w' ? u.box.maxX - u.box.minX : u.box.maxY - u.box.minY);
  for (const u of units.slice(1)) {
    const s = size(u) === 0 ? 1 : size(ref) / size(u);
    for (const id of u.ids) out.set(id, s);
  }
  return out;
}
