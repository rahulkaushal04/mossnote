/** Pure layout math. Widths are px; the editor never gets less than EDITOR_MIN. */
export const NAV = { min: 160, max: 400 } as const;
export const LIST = { min: 200, max: 560 } as const;
export const EDITOR_MIN = 360;
export const SPLITTER_W = 6;

export interface Sizes {
  nav: number;
  list: number;
  navCollapsed: boolean;
}
export interface Effective {
  nav: number;
  list: number;
  /** Collapsed by the user, or forced because the window is too narrow. */
  navHidden: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Preferred sizes -> sizes that fit `windowWidth`. The list shrinks first, then the nav, and the nav
 * hides when even the minimums do not fit. The preferred sizes are never modified (shrinking the
 * window must not overwrite what the user chose).
 */
export function clampSizes(s: Sizes, windowWidth: number): Effective {
  let nav = clamp(s.nav, NAV.min, NAV.max);
  let list = clamp(s.list, LIST.min, LIST.max);
  let navHidden = s.navCollapsed;
  const over = () =>
    (navHidden ? 0 : nav + SPLITTER_W) + list + SPLITTER_W + EDITOR_MIN - windowWidth;
  let o = over();
  if (o > 0) {
    const take = Math.min(o, list - LIST.min);
    list -= take;
    o = over();
  }
  if (o > 0) {
    const take = Math.min(o, nav - NAV.min);
    nav -= take;
    o = over();
  }
  if (o > 0) navHidden = true;
  return { nav, list, navHidden };
}

/** Largest value each splitter may reach in a window of this width, given the other pane's size. */
export function maxFor(which: 'nav' | 'list', s: Sizes, windowWidth: number): number {
  const rest = windowWidth - EDITOR_MIN - SPLITTER_W;
  if (which === 'nav') {
    return clamp(rest - SPLITTER_W - LIST.min, NAV.min, NAV.max);
  }
  const navUsed = s.navCollapsed ? 0 : clamp(s.nav, NAV.min, NAV.max) + SPLITTER_W;
  return clamp(rest - navUsed, LIST.min, LIST.max);
}
