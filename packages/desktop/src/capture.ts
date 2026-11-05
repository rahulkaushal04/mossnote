export const CAPTURE_SHORTCUT = 'CommandOrControl+Shift+Alt+N';

export interface CaptureWindowLike {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  once(ev: 'closed', cb: () => void): unknown;
  webContents?: { send(channel: string, payload: unknown): void };
}
export interface ShortcutApi {
  register(accel: string, cb: () => void): boolean;
  unregisterAll(): void;
}

/** Owns the quick-capture window (one at a time) and the global shortcut. */
export function createCapture(o: {
  create(): CaptureWindowLike;
  shortcuts: ShortcutApi;
  /** Called when the OS refuses the shortcut; the menu command still works. */
  onShortcutFailed(message: string): void;
}) {
  let win: CaptureWindowLike | null = null;
  function open(): void {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    const w = o.create();
    win = w;
    w.once('closed', () => {
      if (win === w) win = null;
    });
  }
  function registerShortcut(): boolean {
    let ok: boolean;
    try {
      ok = o.shortcuts.register(CAPTURE_SHORTCUT, open);
    } catch {
      ok = false;
    }
    if (!ok)
      o.onShortcutFailed(
        `Quick capture shortcut ${CAPTURE_SHORTCUT} is unavailable; use File > Quick capture.`,
      );
    return ok;
  }
  const live = () => (win && !win.isDestroyed() ? win : null);
  return {
    open,
    registerShortcut,
    unregister: () => o.shortcuts.unregisterAll(),
    isOpen: () => live() !== null,
    /** Sends an event to the capture window; false when none is open. */
    notify(channel: string, payload: unknown): boolean {
      const w = live();
      if (!w?.webContents) return false;
      w.webContents.send(channel, payload);
      return true;
    },
  };
}
