/**
 * Quit/close sequencer (CS-12). Closing the window or quitting is held once while the renderer flushes
 * its drafts and saves (`flushRequest` -> rpc `app.flushed {token}`), for at most `timeoutMs`.
 * Pure: all effects are injected, so it is tested with fakes. `dispatcher.close()` runs only in will-quit.
 */
export interface Preventable {
  preventDefault(): void;
}
export interface LifecycleDeps {
  platform: string;
  timeoutMs?: number;
  newToken(): string;
  hasWindow(): boolean;
  sendFlushRequest(token: string): void;
  /** A quick-capture window is open: on quit it must save its text too. */
  hasCapture?(): boolean;
  /** Sends the flush request to the capture window; false when it is gone. */
  sendCaptureFlush?(token: string): boolean;
  closeWindow(): void;
  quit(): void;
  closeDispatcher(): void;
  /** Resolves when background jobs (cleanup, verify) are idle. Awaited before the workspace closes (M11). */
  drain?(): Promise<void>;
  /** Longest wait for `drain` before the workspace closes anyway. Default 5000. */
  drainTimeoutMs?: number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
}

export function createLifecycle(d: LifecycleDeps) {
  const timeoutMs = d.timeoutMs ?? 2000;
  // Every token must be acknowledged: one for the main window, one for the capture window on quit.
  let pending: {
    tokens: Set<string>;
    timer: unknown;
    intent: 'close' | 'quit';
    captureAsked: boolean;
  } | null = null;
  let allowClose = false;
  let allowQuit = false;
  let disposed = false;
  let draining = false;

  function complete(intent: 'close' | 'quit'): void {
    if (intent === 'quit') {
      allowQuit = true;
      d.quit();
    } else {
      allowClose = true;
      d.closeWindow();
    }
  }
  function finish(): void {
    const p = pending;
    if (!p) return;
    pending = null;
    d.clearTimer(p.timer);
    complete(p.intent);
  }
  /** Asks the capture window to save its text; its token joins the pending set. */
  function askCapture(p: NonNullable<typeof pending>): void {
    if (p.captureAsked || !d.hasCapture?.()) return;
    p.captureAsked = true;
    const t = d.newToken();
    if (d.sendCaptureFlush?.(t)) p.tokens.add(t);
  }
  const anyWindow = () => d.hasWindow() || (d.hasCapture?.() ?? false);
  function start(intent: 'close' | 'quit'): void {
    if (pending) {
      if (intent === 'quit') {
        pending.intent = 'quit'; // quit while flushing: same flush, wider outcome
        askCapture(pending);
      }
      return;
    }
    if (!anyWindow()) return complete(intent);
    const p = {
      tokens: new Set<string>(),
      timer: undefined as unknown,
      intent,
      captureAsked: false,
    };
    pending = p;
    p.timer = d.setTimer(finish, timeoutMs);
    if (d.hasWindow()) {
      const token = d.newToken();
      p.tokens.add(token);
      d.sendFlushRequest(token);
    }
    if (intent === 'quit') askCapture(p);
    if (p.tokens.size === 0) finish(); // nobody could be asked
  }

  return {
    onWindowClose(e: Preventable): void {
      if (allowClose || allowQuit) {
        allowClose = false;
        return;
      }
      e.preventDefault();
      start('close');
    },
    onBeforeQuit(e: Preventable): void {
      if (allowQuit || !anyWindow()) return; // no window means nothing unsaved to wait for
      e.preventDefault();
      start('quit');
    },
    /** rpc `app.flushed`; a wrong or stale token is ignored. */
    ack(token: string): boolean {
      if (!pending?.tokens.delete(token)) return false;
      if (pending.tokens.size === 0) finish();
      return true;
    },
    /** Closes the workspace; with `drain` it first waits (bounded) for running jobs, then quits again. */
    onWillQuit(e?: Preventable): void {
      if (disposed || draining) return;
      if (!d.drain) {
        disposed = true;
        d.closeDispatcher();
        return;
      }
      draining = true;
      e?.preventDefault();
      let timer: unknown;
      const done = () => {
        if (disposed) return;
        disposed = true;
        d.clearTimer(timer);
        d.closeDispatcher();
        d.quit(); // will-quit runs again; `disposed` lets it through
      };
      timer = d.setTimer(done, d.drainTimeoutMs ?? 5000);
      void d.drain().then(done, done);
    },
    /** Windows/Linux quit with the last window; macOS keeps the workspace and shortcut alive. */
    onAllWindowsClosed(): void {
      if (d.platform !== 'darwin') d.quit();
    },
    get flushing(): boolean {
      return pending !== null;
    },
  };
}
