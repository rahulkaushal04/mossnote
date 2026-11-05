import { describe, expect, it } from 'vitest';
import { CAPTURE_SHORTCUT, createCapture, type CaptureWindowLike } from './capture.ts';

function setup(registerOk: boolean) {
  const wins: (CaptureWindowLike & {
    closed(): void;
    calls: string[];
    sent: unknown[][];
    destroyed: boolean;
    min: boolean;
  })[] = [];
  const msgs: string[] = [];
  let trigger: (() => void) | undefined;
  const reg: string[] = [];
  const cap = createCapture({
    create() {
      let onClosed: () => void = () => {};
      const w = {
        calls: [] as string[],
        destroyed: false,
        min: false,
        isDestroyed: () => w.destroyed,
        isMinimized: () => w.min,
        restore: () => w.calls.push('restore'),
        show: () => w.calls.push('show'),
        focus: () => w.calls.push('focus'),
        once: (_: 'closed', cb: () => void) => void (onClosed = cb),
        sent: [] as unknown[][],
        webContents: { send: (...a: unknown[]) => void w.sent.push(a) },
        closed: () => onClosed(),
      };
      wins.push(w);
      return w;
    },
    shortcuts: {
      register: (a, cb) => (reg.push(a), (trigger = cb), registerOk),
      unregisterAll: () => void 0,
    },
    onShortcutFailed: (m) => msgs.push(m),
  });
  return { cap, wins, msgs, reg, fire: () => trigger?.() };
}

describe('AS-11 capture controller', () => {
  it('registers the documented shortcut and opens a window when pressed', () => {
    const s = setup(true);
    expect(s.cap.registerShortcut()).toBe(true);
    expect(s.reg).toEqual([CAPTURE_SHORTCUT]);
    s.fire();
    expect(s.wins).toHaveLength(1);
  });
  it('reuses an open window and recreates after close', () => {
    const s = setup(true);
    s.cap.open();
    s.cap.open();
    expect(s.wins).toHaveLength(1);
    expect(s.wins[0]?.calls).toEqual(['show', 'focus']);
    s.wins[0]?.closed();
    s.cap.open();
    expect(s.wins).toHaveLength(2);
  });
  it('restores a minimized window; recreates a destroyed one', () => {
    const s = setup(true);
    s.cap.open();
    const w = s.wins[0];
    if (w) w.min = true;
    s.cap.open();
    expect(w?.calls[0]).toBe('restore');
    if (w) w.destroyed = true;
    s.cap.open();
    expect(s.wins).toHaveLength(2);
  });
  it('reports a failed registration, and the command still opens the window', () => {
    const s = setup(false);
    expect(s.cap.registerShortcut()).toBe(false);
    expect(s.msgs).toHaveLength(1);
    s.cap.open();
    expect(s.wins).toHaveLength(1);
  });
  it('notify reaches only an open capture window', () => {
    const s = setup(true);
    expect(s.cap.isOpen()).toBe(false);
    expect(s.cap.notify('ch', { a: 1 })).toBe(false);
    s.cap.open();
    expect(s.cap.isOpen()).toBe(true);
    expect(s.cap.notify('ch', { a: 1 })).toBe(true);
    expect(s.wins[0]?.sent).toEqual([['ch', { a: 1 }]]);
    if (s.wins[0]) s.wins[0].destroyed = true;
    expect(s.cap.isOpen()).toBe(false);
    expect(s.cap.notify('ch', 1)).toBe(false);
  });
});
