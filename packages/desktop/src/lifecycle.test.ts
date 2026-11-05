import { describe, expect, it } from 'vitest';
import { createLifecycle } from './lifecycle.ts';

function setup(platform = 'linux', hasWindow = true) {
  const log: string[] = [];
  let timer: (() => void) | null = null;
  let n = 0;
  const lc = createLifecycle({
    platform,
    newToken: () => `t${++n}`,
    hasWindow: () => hasWindow,
    sendFlushRequest: (t) => log.push(`flush:${t}`),
    closeWindow: () => log.push('closeWindow'),
    quit: () => log.push('quit'),
    closeDispatcher: () => log.push('closeDispatcher'),
    setTimer: (fn, ms) => {
      log.push(`timer:${ms}`);
      timer = fn;
      return 1;
    },
    clearTimer: () => {
      timer = null;
    },
  });
  const ev = () => {
    const e = {
      prevented: 0,
      preventDefault() {
        e.prevented++;
      },
    };
    return e;
  };
  return { lc, log, ev, fire: () => timer?.(), hasTimer: () => timer !== null };
}

describe('lifecycle (CS-12)', () => {
  it('holds the first close, asks for a flush, closes only after the matching ack', () => {
    const s = setup();
    const e = s.ev();
    s.lc.onWindowClose(e);
    expect(e.prevented).toBe(1);
    expect(s.log).toEqual(['timer:2000', 'flush:t1']);
    expect(s.lc.ack('t1')).toBe(true);
    expect(s.log.at(-1)).toBe('closeWindow');
    expect(s.hasTimer()).toBe(false);
    const e2 = s.ev(); // the close that closeWindow() re-emits goes through
    s.lc.onWindowClose(e2);
    expect(e2.prevented).toBe(0);
  });

  it('wrong token is ignored and does not close', () => {
    const s = setup();
    s.lc.onWindowClose(s.ev());
    expect(s.lc.ack('nope')).toBe(false);
    expect(s.log).not.toContain('closeWindow');
    expect(s.lc.flushing).toBe(true);
  });

  it('closes after the 2 s timeout when the renderer never answers', () => {
    const s = setup();
    s.lc.onWindowClose(s.ev());
    s.fire();
    expect(s.log.at(-1)).toBe('closeWindow');
    expect(s.lc.ack('t1')).toBe(false); // late ack is harmless
  });

  it('a second close while flushing neither restarts the flush nor closes', () => {
    const s = setup();
    const a = s.ev();
    const b = s.ev();
    s.lc.onWindowClose(a);
    s.lc.onWindowClose(b);
    expect(b.prevented).toBe(1);
    expect(s.log.filter((l) => l.startsWith('flush'))).toEqual(['flush:t1']);
  });

  it('quit while a close is flushing upgrades it to a quit using the same flush', () => {
    const s = setup();
    s.lc.onWindowClose(s.ev());
    const q = s.ev();
    s.lc.onBeforeQuit(q);
    expect(q.prevented).toBe(1);
    expect(s.log.filter((l) => l.startsWith('flush'))).toEqual(['flush:t1']);
    s.lc.ack('t1');
    expect(s.log.at(-1)).toBe('quit');
    expect(s.log).not.toContain('closeWindow');
    const again = s.ev(); // the re-entered before-quit and window close are allowed
    s.lc.onBeforeQuit(again);
    s.lc.onWindowClose(again);
    expect(again.prevented).toBe(0);
  });

  it('before-quit flushes, then quits; dispatcher closes only in will-quit', () => {
    const s = setup('darwin');
    s.lc.onBeforeQuit(s.ev());
    expect(s.log).not.toContain('closeDispatcher');
    s.lc.ack('t1');
    expect(s.log).not.toContain('closeDispatcher');
    s.lc.onWillQuit();
    s.lc.onWillQuit();
    expect(s.log.filter((l) => l === 'closeDispatcher')).toHaveLength(1);
  });

  it('close never closes the dispatcher', () => {
    const s = setup('darwin');
    s.lc.onWindowClose(s.ev());
    s.lc.ack('t1');
    expect(s.log).not.toContain('closeDispatcher');
  });

  it('before-quit without a window does not wait', () => {
    const s = setup('linux', false);
    const e = s.ev();
    s.lc.onBeforeQuit(e);
    expect(e.prevented).toBe(0);
    expect(s.log).toEqual([]);
  });

  it('macOS keeps the app alive when the last window closes; others quit', () => {
    const mac = setup('darwin');
    mac.lc.onAllWindowsClosed();
    expect(mac.log).not.toContain('quit');
    for (const p of ['win32', 'linux']) {
      const o = setup(p);
      o.lc.onAllWindowsClosed();
      expect(o.log).toContain('quit');
    }
  });
});

describe('lifecycle: the quick-capture window keeps its text on quit', () => {
  function withCapture(opts: { main?: boolean; capture?: boolean } = {}) {
    const log: string[] = [];
    let n = 0;
    let timer: (() => void) | null = null;
    const lc = createLifecycle({
      platform: 'linux',
      newToken: () => `t${++n}`,
      hasWindow: () => opts.main ?? true,
      sendFlushRequest: (t) => log.push(`main:${t}`),
      hasCapture: () => opts.capture ?? true,
      sendCaptureFlush: (t) => (log.push(`capture:${t}`), true),
      closeWindow: () => log.push('closeWindow'),
      quit: () => log.push('quit'),
      closeDispatcher: () => log.push('closeDispatcher'),
      setTimer: (fn) => ((timer = fn), 1),
      clearTimer: () => (timer = null),
    });
    const ev = () => ({ preventDefault() {} });
    return { lc, log, ev, fire: () => timer?.() };
  }

  it('quit asks both windows and waits for both acknowledgements', () => {
    const s = withCapture();
    s.lc.onBeforeQuit(s.ev());
    expect(s.log).toEqual(['main:t1', 'capture:t2']);
    s.lc.ack('t1');
    expect(s.log).not.toContain('quit'); // the capture window has not saved yet
    s.lc.ack('t2');
    expect(s.log.at(-1)).toBe('quit');
  });

  it('a capture window that never answers is waited for at most the timeout', () => {
    const s = withCapture();
    s.lc.onBeforeQuit(s.ev());
    s.lc.ack('t1');
    s.fire();
    expect(s.log.at(-1)).toBe('quit');
  });

  it('closing only the main window does not touch the capture window', () => {
    const s = withCapture();
    s.lc.onWindowClose(s.ev());
    expect(s.log).toEqual(['main:t1']);
    s.lc.ack('t1');
    expect(s.log.at(-1)).toBe('closeWindow');
  });

  it('a quit that arrives while a close is flushing also asks the capture window', () => {
    const s = withCapture();
    s.lc.onWindowClose(s.ev());
    s.lc.onBeforeQuit(s.ev());
    expect(s.log).toEqual(['main:t1', 'capture:t2']);
    s.lc.ack('t1');
    s.lc.ack('t2');
    expect(s.log.at(-1)).toBe('quit');
  });

  it('with only the capture window left (macOS, main closed) quit still waits for it', () => {
    const s = withCapture({ main: false });
    s.lc.onBeforeQuit(s.ev());
    expect(s.log).toEqual(['capture:t1']);
    s.lc.ack('t1');
    expect(s.log.at(-1)).toBe('quit');
  });
});

describe('lifecycle drain before close (M11)', () => {
  function drainSetup() {
    const log: string[] = [];
    let timerFn: (() => void) | null = null;
    let release: () => void = () => {};
    const lc = createLifecycle({
      platform: 'linux',
      newToken: () => 't',
      hasWindow: () => false,
      sendFlushRequest: () => {},
      closeWindow: () => {},
      quit: () => log.push('quit'),
      closeDispatcher: () => log.push('closeDispatcher'),
      drain: () => new Promise<void>((r) => (release = r)),
      drainTimeoutMs: 777,
      setTimer: (fn, ms) => {
        log.push(`timer:${ms}`);
        timerFn = fn;
        return 1;
      },
      clearTimer: () => log.push('clear'),
    });
    return { lc, log, release: () => release(), fire: () => timerFn?.() };
  }
  const ev = () => {
    const e = { prevented: 0, preventDefault: () => void e.prevented++ };
    return e;
  };

  it('holds will-quit until the jobs are idle, then closes and quits again once', async () => {
    const s = drainSetup();
    const e = ev();
    s.lc.onWillQuit(e);
    expect(e.prevented).toBe(1);
    expect(s.log).toEqual(['timer:777']); // not closed while a job runs
    s.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.log).toEqual(['timer:777', 'clear', 'closeDispatcher', 'quit']);
    const e2 = ev(); // the re-emitted will-quit goes through
    s.lc.onWillQuit(e2);
    expect(e2.prevented).toBe(0);
    expect(s.log.filter((l) => l === 'closeDispatcher')).toHaveLength(1);
  });

  it('closes anyway when the jobs never finish (timeout)', () => {
    const s = drainSetup();
    s.lc.onWillQuit(ev());
    s.fire();
    expect(s.log).toEqual(['timer:777', 'clear', 'closeDispatcher', 'quit']);
  });

  it('a second will-quit while draining does not start a second drain', () => {
    const s = drainSetup();
    s.lc.onWillQuit(ev());
    s.lc.onWillQuit(ev());
    expect(s.log).toEqual(['timer:777']);
  });
});
