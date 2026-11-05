import fs from 'node:fs';
import path from 'node:path';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowState extends Partial<Bounds> {
  width: number;
  height: number;
  maximized: boolean;
}
export interface Display {
  workArea: Bounds;
  primary?: boolean;
}

export const DEFAULT_SIZE = { width: 1000, height: 700 };
const MIN = { width: 400, height: 300 };
const STRIP = 64;

const overlap = (a: Bounds, b: Bounds) => ({
  w: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  h: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});

/** Pure: puts saved bounds on a visible display. Never returns a window the user cannot reach. */
export function clampBounds(saved: WindowState | null, displays: readonly Display[]): WindowState {
  const s = saved ?? { ...DEFAULT_SIZE, maximized: false };
  const primary = displays.find((d) => d.primary) ?? displays[0];
  if (!primary) return { ...s, x: undefined, y: undefined };
  const fit = (wa: Bounds) => ({
    width: Math.max(Math.min(MIN.width, wa.width), Math.min(s.width, wa.width)),
    height: Math.max(Math.min(MIN.height, wa.height), Math.min(s.height, wa.height)),
  });
  if (s.x !== undefined && s.y !== undefined) {
    // The title strip (top 64 px) must overlap some display by at least 64 x 64.
    const strip = { x: s.x, y: s.y, width: s.width, height: STRIP };
    const home = displays.find((d) => {
      const o = overlap(strip, d.workArea);
      return o.w >= STRIP && o.h >= STRIP;
    });
    if (home) {
      const wa = home.workArea;
      const { width, height } = fit(wa);
      return {
        width,
        height,
        maximized: s.maximized,
        x: Math.min(Math.max(s.x, wa.x), wa.x + wa.width - width),
        y: Math.min(Math.max(s.y, wa.y), wa.y + wa.height - height),
      };
    }
  }
  const wa = primary.workArea;
  const { width, height } = fit(wa);
  return {
    width,
    height,
    maximized: s.maximized,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
  };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Missing, unreadable or corrupt file gives null (defaults). */
export function loadWindowState(file: string): WindowState | null {
  try {
    const j: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof j !== 'object' || j === null) return null;
    const o = j as Record<string, unknown>;
    if (!num(o.width) || !num(o.height) || o.width < 100 || o.height < 100) return null;
    const pos = num(o.x) && num(o.y) ? { x: o.x, y: o.y } : {};
    return { width: o.width, height: o.height, maximized: o.maximized === true, ...pos };
  } catch {
    return null;
  }
}

/** tmp + rename, so a crash mid-write never leaves a half file. */
export function saveWindowState(file: string, s: WindowState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, file);
}

export interface Debounced {
  (): void;
  flush(): void;
  cancel(): void;
}
export function debounce(
  fn: () => void,
  ms: number,
  t: { set(f: () => void, ms: number): unknown; clear(h: unknown): void } = {
    set: (f, m) => setTimeout(f, m),
    clear: (h) => clearTimeout(h as NodeJS.Timeout),
  },
): Debounced {
  let h: unknown = null;
  const run = () => {
    h = null;
    fn();
  };
  const d = (() => {
    if (h !== null) t.clear(h);
    h = t.set(run, ms);
  }) as Debounced;
  d.flush = () => {
    if (h !== null) {
      t.clear(h);
      run();
    }
  };
  d.cancel = () => {
    if (h !== null) t.clear(h);
    h = null;
  };
  return d;
}

/** The slice of BrowserWindow and `screen` that state tracking needs. */
export interface TrackedWindow {
  on(ev: 'resize' | 'move' | 'close' | 'maximize' | 'unmaximize', cb: () => void): unknown;
  getNormalBounds(): Bounds;
  isMaximized(): boolean;
  setBounds(b: Bounds): void;
}
export interface ScreenLike {
  getAllDisplays(): Display[];
  on(ev: 'display-removed' | 'display-metrics-changed', cb: () => void): unknown;
}

/** Saves on move/resize (debounced) and on close; re-clamps when a display goes away. */
export function trackWindowState(
  win: TrackedWindow,
  screen: ScreenLike,
  file: string,
  debounceMs = 500,
  timers?: Parameters<typeof debounce>[2],
): void {
  const snapshot = (): WindowState => ({ ...win.getNormalBounds(), maximized: win.isMaximized() });
  const save = debounce(
    () => {
      try {
        saveWindowState(file, snapshot());
      } catch {
        // Losing a window position is not worth interrupting the user.
      }
    },
    debounceMs,
    timers,
  );
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) win.on(ev, save);
  win.on('close', () => {
    save.cancel();
    try {
      saveWindowState(file, snapshot());
    } catch {
      // see above
    }
  });
  const reclamp = () => {
    if (win.isMaximized()) return;
    const c = clampBounds(snapshot(), screen.getAllDisplays());
    if (c.x !== undefined && c.y !== undefined)
      win.setBounds({ x: c.x, y: c.y, width: c.width, height: c.height });
  };
  screen.on('display-removed', reclamp);
}
