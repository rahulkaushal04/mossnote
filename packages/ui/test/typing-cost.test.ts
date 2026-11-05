// @vitest-environment jsdom
// M-b: a keystroke in a 5 MB note must not copy the document; reads are bounded by the journal throttle.
import { EditorState } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../src/editor/autosave';
import { createEditor } from '../src/editor/createEditor';
import { manualTimers } from './helpers/timers';

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
Range.prototype.getClientRects ??= noRects as never;
Range.prototype.getBoundingClientRect ??= (() => new DOMRect()) as never;

let host: HTMLElement | undefined;
afterEach(() => {
  host?.remove();
  vi.restoreAllMocks();
});

describe('typing in a 5 MB note', () => {
  const big = 'lorem ipsum dolor '.repeat(Math.ceil(5_000_000 / 18));

  async function run(gapMs: number) {
    host = document.createElement('div');
    document.body.append(host);
    const timers = manualTimers();
    const hook: { change?: () => void } = {};
    const ed = createEditor(host, { doc: big, onDirty: () => hook.change?.() });
    let reads = 0;
    const writes: number[] = [];
    const m = createAutosave({
      noteId: 'n',
      base: { rev: 1, contentHash: 'a'.repeat(64) },
      initialText: big,
      getText: () => (reads++, ed.getText()),
      writeDraft: async (_id, t) => (writes.push(t.length), { ok: true, value: undefined }),
      save: async () => ({ ok: false, error: { code: 'io', message: 'unused' } }),
      timers,
      onState: () => {},
    });
    hook.change = () => m.change();
    const slice = vi.spyOn(EditorState.prototype, 'sliceDoc');
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      ed.view.dispatch({ changes: { from: i, insert: 'x' } });
      if (gapMs) await timers.advance(gapMs);
    }
    if (!gapMs) await timers.advance(100); // the throttle's trailing read picks up the last keystroke
    const ms = performance.now() - t0;
    const sliceCalls = slice.mock.calls.length;
    m.dispose();
    ed.destroy();
    return { ms, reads, writes: writes.length, sliceCalls };
  }

  it('200 back-to-back keystrokes read the text twice (leading write, trailing write), within a generous time budget', async () => {
    const r = await run(0);
    expect(r.ms).toBeLessThan(15_000);
    expect(r.reads).toBe(2);
    expect(r.writes).toBe(2);
    expect(r.sliceCalls).toBe(2);
  });

  it('200 keystrokes 10 ms apart read the text about once per 100 ms, not once per keystroke', async () => {
    const r = await run(10);
    expect(r.reads).toBeLessThanOrEqual(25); // ~2 s / 100 ms plus the leading write
    expect(r.reads).toBeGreaterThanOrEqual(15);
    expect(r.sliceCalls).toBe(r.reads);
    expect(r.writes).toBe(r.reads);
  });
});
