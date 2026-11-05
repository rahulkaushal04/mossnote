import { afterEach, describe, expect, it, vi } from 'vitest';

const exposed: Record<string, Record<string, unknown>> = {};
const listeners = new Map<string, (...a: unknown[]) => void>();
const removed: string[] = [];
const invoke = vi.fn(async (..._a: unknown[]) => 'reply' as unknown);
vi.mock('electron', () => ({
  webUtils: {
    getPathForFile: (f: { path?: string; boom?: boolean }) => {
      if (f.boom) throw new Error('not a File');
      return f.path ?? '';
    },
  },
  contextBridge: {
    exposeInMainWorld: (k: string, api: Record<string, unknown>) => (exposed[k] = api),
  },
  ipcRenderer: {
    invoke: (...a: unknown[]) => invoke(...a),
    on: (c: string, f: (...a: unknown[]) => void) => listeners.set(c, f),
    removeListener: (c: string) => removed.push(c),
  },
}));

const load = async (argv: string[]) => {
  vi.resetModules();
  const saved = process.argv;
  process.argv = [...saved, ...argv];
  try {
    await import('./preload.ts');
  } finally {
    process.argv = saved;
  }
  return exposed.mossnote!;
};
afterEach(() => {
  listeners.clear();
  invoke.mockClear();
});

describe('preload (AS-13)', () => {
  it('exposes rpc, onEvent and native in a normal run; the smoke probes need the e2e argument', async () => {
    expect(Object.keys(await load([])).sort()).toEqual(['native', 'onEvent', 'rpc']);
    expect(Object.keys(await load(['--mossnote-e2e'])).sort()).toEqual([
      'fts5Probe',
      'native',
      'onEvent',
      'ping',
      'rpc',
    ]);
  });

  it('the capture window never gets native', async () => {
    expect(Object.keys(await load(['--mossnote-capture'])).sort()).toEqual(['onEvent', 'rpc']);
  });

  it('native exposes exactly the frozen surface', async () => {
    const native = (await load([])).native as Record<string, unknown>;
    expect(Object.keys(native).sort()).toEqual([
      'dropTokens',
      'loadRemoteImage',
      'pasteImage',
      'pickFile',
      'readText',
      'reveal',
      'saveCopy',
    ]);
  });

  it('dropTokens sends main only the paths the preload read, never the File objects', async () => {
    const native = (await load([])).native as {
      dropTokens(files: unknown): Promise<unknown>;
    };
    invoke.mockResolvedValueOnce(['tok1']);
    const files = [{ path: '/a.png' }, { path: '' }, { boom: true }, { path: '/b.png' }];
    expect(await native.dropTokens(files)).toEqual(['tok1']);
    expect(invoke.mock.calls).toEqual([['mossnote:native:dropTokens', ['/a.png', '/b.png']]]);
    invoke.mockClear();
    expect(await native.dropTokens([{ path: '' }])).toEqual([]); // nothing to register, no round trip
    expect(await native.dropTokens('nope')).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('the other native calls use their own channels, not the rpc channel', async () => {
    const native = (await load([])).native as Record<string, (...a: unknown[]) => Promise<unknown>>;
    await native.pickFile!();
    await native.pasteImage!('n1');
    await native.reveal!('s', 'n1');
    await native.saveCopy!('s');
    await native.loadRemoteImage!('https://x.example/a.png');
    await native.readText!('s', undefined, 100);
    expect(invoke.mock.calls.map((c) => c[0])).toEqual([
      'mossnote:native:pickFile',
      'mossnote:native:pasteImage',
      'mossnote:native:reveal',
      'mossnote:native:saveCopy',
      'mossnote:native:loadRemoteImage',
      'mossnote:native:readText',
    ]);
  });

  it('passes the callback the payload only, never the IpcRendererEvent, and unsubscribes', async () => {
    const api = await load([]);
    const got: unknown[][] = [];
    const off = (api.onEvent as (cb: (...a: unknown[]) => void) => () => void)((...a) =>
      got.push(a),
    );
    const fire = listeners.get('mossnote:event')!;
    const fakeEvent = { sender: { send() {} }, ports: [] };
    fire(fakeEvent, { type: 'status', message: 'hi', level: 'info' });
    expect(got).toEqual([[{ type: 'status', message: 'hi', level: 'info' }]]);
    expect(got[0]).toHaveLength(1);
    expect(got[0]![0]).not.toBe(fakeEvent);
    off();
    expect(removed).toEqual(['mossnote:event']);
  });
});
