import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clampBounds,
  debounce,
  loadWindowState,
  saveWindowState,
  trackWindowState,
  type Display,
  type TrackedWindow,
} from './windowState.ts';

const d1: Display = { primary: true, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const d2: Display = { workArea: { x: 1440, y: 0, width: 1920, height: 1080 } };
const left: Display = { workArea: { x: -1280, y: 0, width: 1280, height: 1024 } };
const st = (o: object) => ({ width: 1000, height: 700, maximized: false, ...o });

describe('AS-15 clampBounds', () => {
  it('keeps visible bounds', () => {
    expect(clampBounds(st({ x: 100, y: 100 }), [d1])).toEqual(st({ x: 100, y: 100 }));
  });
  it('centers on the primary when there are no saved bounds', () => {
    expect(clampBounds(null, [d1])).toEqual(st({ x: 220, y: 113 }));
  });
  it('recovers a window saved on a removed second display', () => {
    const r = clampBounds(st({ x: 2000, y: 100 }), [d1]);
    expect(r.x).toBe(220);
    expect(r.y).toBe(113);
  });
  it('keeps a window on a second display that still exists', () => {
    expect(clampBounds(st({ x: 2000, y: 100 }), [d1, d2]).x).toBe(2000);
  });
  it('accepts negative coordinates on a left-hand display', () => {
    const r = clampBounds(st({ x: -1200, y: 50, width: 600 }), [d1, left]);
    expect(r.x).toBe(-1200);
  });
  it('rejects negative coordinates when no such display exists', () => {
    expect(clampBounds(st({ x: -5000, y: 0 }), [d1]).x).toBe(220);
  });
  it('treats a barely visible title strip as off-screen', () => {
    expect(clampBounds(st({ x: 1420, y: 100 }), [d1]).x).toBe(220);
    expect(clampBounds(st({ x: 100, y: 880 }), [d1]).y).toBe(113);
  });
  it('caps a window bigger than the work area and keeps it inside', () => {
    const r = clampBounds(st({ x: 50, y: 50, width: 5000, height: 4000 }), [d1]);
    expect(r).toMatchObject({ x: 0, y: 25, width: 1440, height: 875 });
  });
  it('pulls a partly off-screen window back inside', () => {
    const r = clampBounds(st({ x: 900, y: 600 }), [d1]);
    expect(r.x).toBe(440);
    expect(r.y).toBe(200);
  });
  it('preserves maximized', () => {
    expect(clampBounds(st({ x: 9999, y: 9999, maximized: true }), [d1]).maximized).toBe(true);
  });
  it('survives no displays', () => {
    expect(clampBounds(st({ x: 1, y: 1 }), [])).toMatchObject({ width: 1000, x: undefined });
  });
});

describe('AS-15 persistence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-ws-'));
  it('round-trips and leaves no tmp file', () => {
    const f = path.join(dir, 'sub', 'window-state.json');
    saveWindowState(f, st({ x: 5, y: 6, maximized: true }));
    expect(loadWindowState(f)).toEqual(st({ x: 5, y: 6, maximized: true }));
    expect(fs.readdirSync(path.dirname(f))).toEqual(['window-state.json']);
  });
  it('falls back to null on missing or corrupt files', () => {
    expect(loadWindowState(path.join(dir, 'none.json'))).toBeNull();
    for (const bad of ['{', '[]', 'null', '{"width":"a","height":1}', '{"width":5,"height":5}']) {
      const f = path.join(dir, 'bad.json');
      fs.writeFileSync(f, bad);
      expect(loadWindowState(f), bad).toBeNull();
    }
  });
});

describe('AS-15 tracking', () => {
  function fake() {
    const timers: (() => void)[] = [];
    const handlers = new Map<string, () => void>();
    const screenHandlers = new Map<string, () => void>();
    let bounds = { x: 2000, y: 100, width: 1000, height: 700 };
    const set: unknown[] = [];
    const win: TrackedWindow = {
      on: (ev, cb) => void handlers.set(ev, cb),
      getNormalBounds: () => bounds,
      isMaximized: () => false,
      setBounds: (b) => void set.push(b),
    };
    let displays = [d1, d2];
    const screen = {
      getAllDisplays: () => displays,
      on: (ev: string, cb: () => void) => void screenHandlers.set(ev, cb),
    };
    return {
      win,
      screen,
      timers,
      handlers,
      screenHandlers,
      set,
      setDisplays: (d: Display[]) => (displays = d),
      setBounds: (b: typeof bounds) => (bounds = b),
    };
  }
  const timerApi = (t: (() => void)[]) => ({
    set: (f: () => void) => (t.push(f), t.length),
    clear: () => void 0,
  });

  it('debounces move/resize and writes immediately on close', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mn-ws-')), 'w.json');
    const t = fake();
    trackWindowState(t.win, t.screen, f, 500, timerApi(t.timers));
    t.handlers.get('move')?.();
    expect(fs.existsSync(f)).toBe(false);
    t.timers.at(-1)?.();
    expect(loadWindowState(f)?.x).toBe(2000);
    t.setBounds({ x: 10, y: 30, width: 800, height: 600 });
    t.handlers.get('close')?.();
    expect(loadWindowState(f)?.x).toBe(10);
  });

  it('re-clamps when a display is removed', () => {
    const t = fake();
    trackWindowState(t.win, t.screen, path.join(os.tmpdir(), 'unused.json'));
    t.setDisplays([d1]);
    t.screenHandlers.get('display-removed')?.();
    expect(t.set).toEqual([{ x: 220, y: 113, width: 1000, height: 700 }]);
  });
});

describe('debounce', () => {
  it('collapses calls and flush runs pending work once', () => {
    let n = 0;
    const q: (() => void)[] = [];
    const d = debounce(() => n++, 10, { set: (f) => (q.push(f), q.length), clear: () => void 0 });
    d();
    d();
    d.flush();
    d.flush();
    expect(n).toBe(1);
  });
});
