import { describe, expect, it } from 'vitest';
import {
  createDialogGate,
  createPickers,
  createRestart,
  createWarnSink,
  runPendingRestore,
  type PickDialogs,
} from './portability.ts';

function dialogs(o: { open?: { canceled: boolean; filePaths: string[] }; save?: { canceled: boolean; filePath?: string } } = {}) {
  const calls: unknown[] = [];
  const d: PickDialogs = {
    open: async (x) => (calls.push(x), o.open ?? { canceled: false, filePaths: ['/pick/dir'] }),
    save: async (x) => (calls.push(x), o.save ?? { canceled: false, filePath: '/pick/out.mossbak' }),
  };
  return { d, calls };
}

describe('pick hooks (PT-6..PT-8)', () => {
  it('directory pickers allow creating a folder and return the absolute path', async () => {
    const s = dialogs();
    const p = createPickers(s.d);
    expect(await p.pickExportDir()).toBe('/pick/dir');
    expect(await p.pickImportDir()).toBe('/pick/dir');
    for (const c of s.calls) expect((c as { properties: string[] }).properties).toEqual(['openDirectory', 'createDirectory']);
  });
  it('the restore picker is filtered to .mossbak', async () => {
    const s = dialogs({ open: { canceled: false, filePaths: ['/b/x.mossbak'] } });
    expect(await createPickers(s.d).pickBackupOpenPath()).toBe('/b/x.mossbak');
    expect(s.calls[0]).toMatchObject({ properties: ['openFile'], filters: [{ extensions: ['mossbak'] }] });
  });
  it('the save dialog proposes the suggested name without any directory part', async () => {
    const s = dialogs();
    expect(await createPickers(s.d).pickBackupSavePath('../../etc/Mossnote backup.mossbak')).toBe('/pick/out.mossbak');
    expect(s.calls[0]).toMatchObject({ defaultPath: 'Mossnote backup.mossbak' });
  });
  it('cancel gives null; a relative, empty or NUL path is refused as null', async () => {
    const p = (r: { canceled: boolean; filePaths: string[] }) => createPickers(dialogs({ open: r }).d).pickExportDir();
    expect(await p({ canceled: true, filePaths: ['/x'] })).toBeNull();
    expect(await p({ canceled: false, filePaths: [] })).toBeNull();
    expect(await p({ canceled: false, filePaths: ['rel/dir'] })).toBeNull();
    expect(await p({ canceled: false, filePaths: ['/a\0b'] })).toBeNull();
  });
  it('only one dialog at a time: a second request while one is open answers null without opening', async () => {
    let release: (v: { canceled: boolean; filePaths: string[] }) => void = () => {};
    let opened = 0;
    const d: PickDialogs = {
      open: () => (opened++, new Promise((r) => (release = r))),
      save: async () => ({ canceled: true }),
    };
    const p = createPickers(d);
    const first = p.pickExportDir();
    expect(await p.pickImportDir()).toBeNull();
    expect(await p.pickBackupSavePath('a.mossbak')).toBeNull();
    release({ canceled: false, filePaths: ['/ok'] });
    expect(await first).toBe('/ok');
    expect(opened).toBe(1);
    const again = p.pickExportDir();
    release({ canceled: false, filePaths: ['/ok2'] });
    expect(await again).toBe('/ok2');
  });
  it('the gate is released when the dialog throws', async () => {
    const gate = createDialogGate();
    await expect(gate('busy', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await gate('busy', async () => 'ran')).toBe('ran');
  });
});

describe('restartForRestore', () => {
  it('registers the relaunch, then quits through the normal path, once', () => {
    const log: string[] = [];
    const r = createRestart({ relaunch: () => log.push('relaunch'), quit: () => log.push('quit') });
    r();
    r();
    expect(log).toEqual(['relaunch', 'quit']);
  });
});

describe('warn sink', () => {
  it('queues until bound, then delivers in order and straight through', () => {
    const got: string[] = [];
    const s = createWarnSink();
    s.warn('a');
    s.warn('b');
    s.bind((m) => got.push(m));
    s.warn('c');
    expect(got).toEqual(['a', 'b', 'c']);
  });
});

describe('startup restore', () => {
  const base = () => {
    const log: string[] = [];
    return {
      log,
      deps: {
        dbPath: '/data/mossnote.db',
        showError: (t: string, m: string) => void log.push(`error:${t}|${m}`),
        warn: (m: string) => void log.push(`warn:${m}`),
      },
    };
  };
  it('an error shows the message and says do not open the workspace', () => {
    const s = base();
    const go = runPendingRestore({ ...s.deps, apply: () => ({ ok: false, error: { message: 'It is locked.' } }) });
    expect(go).toBe(false);
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toContain('It is locked.');
  });
  it('nothing pending, or applied, goes on without a message', () => {
    for (const applied of [false, true]) {
      const s = base();
      expect(runPendingRestore({ ...s.deps, apply: () => ({ ok: true, value: { applied } }) })).toBe(true);
      expect(s.log).toEqual([]);
    }
  });
  it('a discarded restore goes on and warns with the reason', () => {
    const s = base();
    const go = runPendingRestore({ ...s.deps, apply: () => ({ ok: true, value: { applied: false, discarded: 'it failed verification' } }) });
    expect(go).toBe(true);
    expect(s.log).toEqual(['warn:The pending restore was not applied: it failed verification']);
  });
  it('passes the db path to the apply function', () => {
    const s = base();
    let seen = '';
    runPendingRestore({ ...s.deps, apply: (p) => ((seen = p), { ok: true, value: { applied: false } }) });
    expect(seen).toBe('/data/mossnote.db');
  });
});
