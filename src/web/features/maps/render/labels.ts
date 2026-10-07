/**
 * Placing name labels beside objects so they do not overlap each other.
 */
export interface LabelBox {
  id: string;
  /** Screen position of the pin's centre. */
  x: number;
  y: number;
  /** Rough width of the label in pixels. */
  w: number;
}

export type Side = 'below' | 'above' | 'right' | 'left';

export interface Placed {
  id: string;
  side: Side;
  /** Offset from the pin centre to the label's anchor, in pixels. */
  dx: number;
  dy: number;
  anchor: 'middle' | 'start' | 'end';
}

const H = 15;
const R = 13;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function rectFor(l: LabelBox, side: Side): { rect: Rect; placed: Placed } {
  switch (side) {
    case 'below':
      return {
        rect: { x0: l.x - l.w / 2, x1: l.x + l.w / 2, y0: l.y + R + 1, y1: l.y + R + 1 + H },
        placed: { id: l.id, side, dx: 0, dy: R + H - 3, anchor: 'middle' },
      };
    case 'above':
      return {
        rect: { x0: l.x - l.w / 2, x1: l.x + l.w / 2, y0: l.y - R - 1 - H, y1: l.y - R - 1 },
        placed: { id: l.id, side, dx: 0, dy: -R - 5, anchor: 'middle' },
      };
    case 'right':
      return {
        rect: { x0: l.x + R + 3, x1: l.x + R + 3 + l.w, y0: l.y - H / 2, y1: l.y + H / 2 },
        placed: { id: l.id, side, dx: R + 4, dy: 4, anchor: 'start' },
      };
    case 'left':
      return {
        rect: { x0: l.x - R - 3 - l.w, x1: l.x - R - 3, y0: l.y - H / 2, y1: l.y + H / 2 },
        placed: { id: l.id, side, dx: -R - 4, dy: 4, anchor: 'end' },
      };
  }
}

/**
 * Put each pin's name where it does not cover another name or pin: below if that is free,
 * otherwise above, to the right or to the left. Falls back to below when everything is taken.
 */
export function placeLabels(labels: readonly LabelBox[]): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const taken: Rect[] = labels.map((l) => ({ x0: l.x - R, x1: l.x + R, y0: l.y - R, y1: l.y + R }));
  const sorted = [...labels].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const l of sorted) {
    let chosen: { rect: Rect; placed: Placed } | null = null;
    for (const side of ['below', 'above', 'right', 'left'] as const) {
      const c = rectFor(l, side);
      if (!taken.some((t) => overlaps(t, c.rect))) {
        chosen = c;
        break;
      }
    }
    const final = chosen ?? rectFor(l, 'below');
    taken.push(final.rect);
    out.set(l.id, final.placed);
  }
  return out;
}
