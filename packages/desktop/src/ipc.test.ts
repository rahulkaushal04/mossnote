import { CAPTURE_METHODS } from '@mossnote/core/rpc';
import { describe, expect, it } from 'vitest';
import { CHANNELS, forwardEvents, isOurPage, registerRpc, type IpcEventLike } from './ipc.ts';
import type { WindowKind } from './window.ts';

const uiIndex = '/app/ui/dist/index.html';
const ours = 'file:///app/ui/dist/index.html';

function setup() {
  let handler: ((e: IpcEventLike, ...a: unknown[]) => unknown) | undefined;
  const calls: unknown[][] = [];
  const kinds = new Map<number, WindowKind>([
    [1, 'main'],
    [2, 'capture'],
  ]);
  registerRpc({
    ipcMain: { handle: (ch, fn) => ch === CHANNELS.rpc && (handler = fn) },
    dispatcher: { handle: async (m, a) => (calls.push([m, a]), { ok: true, value: 'v' }) },
    kinds,
    uiIndex,
    captureMethods: CAPTURE_METHODS,
  });
  const call = (id: number, url: string | undefined, m: unknown, a: unknown = {}) =>
    handler?.(
      { sender: { id }, senderFrame: url === undefined ? null : { url } },
      m,
      a,
    ) as Promise<{ ok: boolean }>;
  return { call, calls };
}

describe('AS-13 ipc trust', () => {
  it('accepts our page including #capture and ?query', async () => {
    const s = setup();
    for (const u of [ours, `${ours}#capture`, `${ours}?a=1#x`])
      expect((await s.call(1, u, 'notes.list')).ok).toBe(true);
    expect(s.calls).toHaveLength(3);
  });
  it('rejects foreign or missing frames and unregistered senders without dispatching', async () => {
    const s = setup();
    for (const u of [
      'https://evil.example/',
      'file:///tmp/x.html',
      'file:///app/ui/dist/other.html',
      'file:///app/ui/dist/index.html/../x',
      undefined,
      'garbage',
    ])
      expect((await s.call(1, u, 'notes.list')).ok, String(u)).toBe(false);
    expect((await s.call(99, ours, 'notes.list')).ok).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
  it('limits the capture window to CAPTURE_METHODS', async () => {
    const s = setup();
    for (const m of CAPTURE_METHODS) expect((await s.call(2, ours, m)).ok, m).toBe(true);
    for (const m of [
      'notes.list',
      'notes.save',
      'app.quit',
      'app.openCapture',
      'drafts.flush',
      '__proto__',
      'constructor',
      5,
      null,
    ])
      expect((await s.call(2, ours, m)).ok, String(m)).toBe(false);
    expect(s.calls).toHaveLength(CAPTURE_METHODS.length);
  });
  it('lets the main window pass any method to the dispatcher (which validates it)', async () => {
    const s = setup();
    await s.call(1, ours, '__proto__');
    expect(s.calls).toEqual([['__proto__', {}]]);
  });
  it('isOurPage ignores hash and search only', () => {
    expect(isOurPage(`${ours}#capture`, uiIndex)).toBe(true);
    expect(isOurPage('file://host/app/ui/dist/index.html', uiIndex)).toBe(false);
  });
  it('broadcasts events to live windows only, payload unchanged', () => {
    const sent: unknown[] = [];
    let cb: (e: never) => void = () => {};
    const mk = (destroyed: boolean) => ({
      isDestroyed: () => destroyed,
      webContents: { send: (c: string, p: unknown) => sent.push([c, p]) },
    });
    forwardEvents({ onEvent: (f) => ((cb = f as never), () => {}) }, () => [mk(false), mk(true)]);
    cb({ type: 'changed', entity: 'note' } as never);
    expect(sent).toEqual([[CHANNELS.event, { type: 'changed', entity: 'note' }]]);
  });
});
