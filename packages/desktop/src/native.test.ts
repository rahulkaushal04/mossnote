import { err, ok, type Result, type VerifiedBlob } from '@mossnote/core';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CHANNELS, type IpcEventLike } from './ipc.ts';
import { registerNative, type NativeWorkspace } from './native.ts';
import { createUploadTokens } from './uploadTokens.ts';
import type { WindowKind } from './window.ts';

const uiIndex = '/app/ui/dist/index.html';
const ours = 'file:///app/ui/dist/index.html';
const SHA = 'b'.repeat(64);

function blobOf(kind: VerifiedBlob['kind'] = 'image', content = 'abc') {
  const bytes = Buffer.from(content);
  const b = {
    closed: 0,
    ranges: [] as unknown[],
    sha256: SHA,
    size: bytes.length,
    mime: 'image/png',
    kind,
    path: '/secret/blobs/bb/bb/file',
    stream: (r?: { start: number; end: number }) => {
      b.ranges.push(r);
      return Readable.from([r ? bytes.subarray(r.start, r.end + 1) : bytes]);
    },
    close() {
      b.closed++;
    },
  };
  return b;
}

function setup(o: { kind?: VerifiedBlob['kind']; content?: string; open?: Result<VerifiedBlob>; png?: Uint8Array | 'too_large' } = {}) {
  const handlers = new Map<string, (e: IpcEventLike, ...a: unknown[]) => unknown>();
  const kinds = new Map<number, WindowKind>([
    [1, 'main'],
    [2, 'capture'],
  ]);
  const blob = blobOf(o.kind, o.content);
  const log: string[] = [];
  const events: unknown[] = [];
  const added: unknown[][] = [];
  let remoteAnswer = true;
  let savePath: string | undefined = '/dest/name.png';
  const ws: NativeWorkspace = {
    attachments: {
      openVerified: async (sha, opts) => {
        log.push(`open:${sha}:${opts?.noteId ?? '-'}`);
        return o.open ?? ok(blob);
      },
      addFromBytes: async (_c, noteId, bytes, name) => {
        added.push([noteId, bytes.length, name]);
        return ok({ refId: 'r1', noteId, name } as never);
      },
      info: async () => ok({ refs: [{ noteId: 'n1', name: 'photo.png' }] }),
    },
  };
  const tokens = createUploadTokens({
    newToken: (() => {
      let n = 0;
      return () => `tok${++n}`;
    })(),
    fs: {
      realpath: async (p) => p,
      stat: async (p) => ({ isFile: () => !p.endsWith('/dir') }),
      access: async () => {},
    },
  });
  registerNative({
    ipcMain: { handle: (ch, fn) => void handlers.set(ch, fn) },
    kinds,
    uiIndex,
    ws: () => ws,
    tokens,
    pickPath: async () => '/home/me/pic.png',
    pickSavePath: async (_id, name) => (log.push(`save:${name}`), savePath),
    confirmRemote: async (_id, host) => (log.push(`confirm:${host}`), remoteAnswer),
    clipboardPng: async () => o.png,
    showInFolder: (p) => void log.push(`reveal:${p}`),
    writeCopy: async (_s, dest) => void log.push(`write:${dest}`),
    loadRemote: async (url) => (log.push(`load:${url}`), { ok: true, dataUrl: 'data:image/png;base64,AA==' }),
    onMutated: (entity, ids) => void events.push({ type: 'changed', entity, ids }),
  });
  // Replies are probed loosely on purpose: the shape differs per channel.
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  type Reply = any;
  const call = (ch: string, args: unknown[] = [], id = 1, url: string | undefined = ours) =>
    handlers.get(ch)!({ sender: { id }, senderFrame: url === undefined ? null : { url } }, ...args) as Promise<Reply>;
  return { call, blob, log, events, added, tokens, setAnswer: (v: boolean) => (remoteAnswer = v), setSave: (v?: string) => (savePath = v) };
}

describe('native attachment channels: trust', () => {
  it('refuses the capture window, foreign pages and unknown senders on every channel', async () => {
    const s = setup();
    const args: Record<string, unknown[]> = {
      [CHANNELS.pasteImage]: ['n1'],
      [CHANNELS.reveal]: [SHA],
      [CHANNELS.saveCopy]: [SHA],
      [CHANNELS.loadRemoteImage]: ['https://img.example/a.png'],
      [CHANNELS.readText]: [SHA, undefined, 100],
      [CHANNELS.dropTokens]: [['/a.png']],
    };
    for (const ch of [CHANNELS.pickFile, CHANNELS.dropTokens, CHANNELS.pasteImage, CHANNELS.reveal, CHANNELS.saveCopy, CHANNELS.loadRemoteImage, CHANNELS.readText]) {
      for (const [id, url] of [[2, ours], [1, 'https://evil.example/'], [9, ours], [1, undefined]] as const) {
        const r = await s.call(ch, args[ch] ?? [], id, url);
        expect(r === undefined || (Array.isArray(r) && r.length === 0) || r.ok === false, `${ch} ${id} ${url}`).toBe(true);
      }
    }
    expect(s.log).toEqual([]);
    expect(s.tokens.size).toBe(0);
  });
});

describe('pick and drop (AT-1)', () => {
  it('pickFile returns a token, never the path', async () => {
    const s = setup();
    const t = await s.call(CHANNELS.pickFile);
    expect(t).toBe('tok1');
    expect(s.tokens.resolve(t)).toBe('/home/me/pic.png');
  });
  it('dropTokens validates every path in main and drops what is refused', async () => {
    const s = setup();
    const r = await s.call(CHANNELS.dropTokens, [['/a.png', '/some/dir', 5, '', '/b.png']]);
    expect(r).toEqual(['tok1', 'tok2']);
    expect(await s.call(CHANNELS.dropTokens, ['/a.png'])).toEqual([]); // not an array
    expect(await s.call(CHANNELS.dropTokens, [Array.from({ length: 101 }, () => '/a.png')])).toEqual([]);
  });
});

describe('pasteImage', () => {
  it('stores the clipboard PNG as "Pasted image.png" and announces the change', async () => {
    const s = setup({ png: new Uint8Array(10) });
    const r = await s.call(CHANNELS.pasteImage, ['n1']);
    expect(r.ok).toBe(true);
    expect(s.added).toEqual([['n1', 10, 'Pasted image.png']]);
    expect(s.events).toEqual([{ type: 'changed', entity: 'attachment', ids: ['n1'] }]);
  });
  it('answers null when there is no image, and rejects a bad note id or an oversize image', async () => {
    expect(await setup().call(CHANNELS.pasteImage, ['n1'])).toEqual({ ok: true, value: null });
    const s = setup({ png: new Uint8Array(1) });
    for (const bad of [5, '', 'x'.repeat(65), undefined, { a: 1 }])
      expect((await s.call(CHANNELS.pasteImage, [bad])).error?.code, String(bad)).toBe('validation');
    const big = setup({ png: 'too_large' });
    expect((await big.call(CHANNELS.pasteImage, ['n1'])).error.code).toBe('validation');
    expect(big.added).toEqual([]);
  });
});

describe('reveal and saveCopy (AT-4)', () => {
  it('reveal verifies first, shows the file, and closes the handle', async () => {
    const s = setup();
    expect(await s.call(CHANNELS.reveal, [SHA, 'n1'])).toEqual({ ok: true, value: undefined });
    expect(s.log).toEqual([`open:${SHA}:n1`, 'reveal:/secret/blobs/bb/bb/file']);
    expect(s.blob.closed).toBe(1);
  });
  it('reveal and save refuse a missing or corrupt file without revealing or writing', async () => {
    const s = setup({ open: err('corrupt', 'This attachment is damaged.', { attachmentState: 'corrupt' }) });
    for (const ch of [CHANNELS.reveal, CHANNELS.saveCopy]) {
      const r = await s.call(ch, [SHA]);
      expect(r).toEqual({ ok: false, error: { code: 'corrupt', message: 'This attachment is damaged.' } });
    }
    expect(s.log.filter((l) => !l.startsWith('open:'))).toEqual([]);
  });
  it('rejects malformed arguments with a typed error', async () => {
    const s = setup();
    for (const ch of [CHANNELS.reveal, CHANNELS.saveCopy])
      for (const args of [[5], ['abc'], [SHA.toUpperCase()], [SHA, 7], [SHA, 'x'.repeat(65)], []])
        expect((await s.call(ch, args)).error.code, `${ch} ${JSON.stringify(args)}`).toBe('validation');
    expect(s.log).toEqual([]);
  });
  it('saveCopy proposes the attachment name, copies the verified bytes, and closes the handle', async () => {
    const s = setup();
    expect(await s.call(CHANNELS.saveCopy, [SHA, 'n1'])).toEqual({ ok: true, value: undefined });
    expect(s.log).toEqual([`open:${SHA}:n1`, 'save:photo.png', 'write:/dest/name.png']);
    expect(s.blob.closed).toBe(1);
  });
  it('a cancelled save dialog writes nothing', async () => {
    const s = setup();
    s.setSave(undefined);
    expect((await s.call(CHANNELS.saveCopy, [SHA])).ok).toBe(true);
    expect(s.log.some((l) => l.startsWith('write:'))).toBe(false);
    expect(s.blob.closed).toBe(1);
  });
  it('saveCopy refuses executables before any dialog; reveal still works', async () => {
    const s = setup({ kind: 'executable' });
    const r = await s.call(CHANNELS.saveCopy, [SHA]);
    expect(r.error.code).toBe('validation');
    expect(s.log.some((l) => l.startsWith('save:'))).toBe(false);
    expect(s.blob.closed).toBe(1);
    expect((await s.call(CHANNELS.reveal, [SHA])).ok).toBe(true);
  });
  it('never puts the file path in a reply', async () => {
    const s = setup();
    const out = JSON.stringify([await s.call(CHANNELS.reveal, [SHA]), await s.call(CHANNELS.saveCopy, [SHA])]);
    expect(out).not.toContain('/secret');
  });
});

describe('loadRemoteImage (AT-10)', () => {
  it('asks for confirmation naming the exact host, then loads', async () => {
    const s = setup();
    const r = await s.call(CHANNELS.loadRemoteImage, ['https://img.example/a.png?q=1']);
    expect(r).toEqual({ ok: true, value: { dataUrl: 'data:image/png;base64,AA==' } });
    expect(s.log).toEqual(['confirm:img.example', 'load:https://img.example/a.png?q=1']);
  });
  it('does not fetch when the user declines', async () => {
    const s = setup();
    s.setAnswer(false);
    const r = await s.call(CHANNELS.loadRemoteImage, ['https://img.example/a.png']);
    expect(r.ok).toBe(false);
    expect(s.log).toEqual(['confirm:img.example']);
  });
  it('rejects non-string, oversize, http and private URLs before any dialog', async () => {
    const s = setup();
    for (const u of [5, undefined, 'http://img.example/a.png', 'https://127.0.0.1/a.png', 'https://x.example/' + 'a'.repeat(3000)])
      expect((await s.call(CHANNELS.loadRemoteImage, [u])).error.code, String(u)).toBe('validation');
    expect(s.log).toEqual([]);
  });
});

describe('readText (AT-6)', () => {
  it('returns the text of a verified text attachment and closes the handle', async () => {
    const s = setup({ kind: 'text', content: 'héllo' });
    expect(await s.call(CHANNELS.readText, [SHA, 'n1', 1000])).toEqual({ ok: true, value: { text: 'héllo', truncated: false } });
    expect(s.log).toEqual([`open:${SHA}:n1`]);
    expect(s.blob.closed).toBe(1);
  });
  it('cuts at the cap, reports truncation, and reads only cap+1 bytes', async () => {
    const s = setup({ kind: 'text', content: 'abcdefghij' });
    expect(await s.call(CHANNELS.readText, [SHA, undefined, 4])).toEqual({ ok: true, value: { text: 'abcd', truncated: true } });
    expect(s.blob.ranges).toEqual([{ start: 0, end: 4 }]);
    // exactly the cap is not truncated
    expect((await s.call(CHANNELS.readText, [SHA, undefined, 10])).value).toEqual({ text: 'abcdefghij', truncated: false });
  });
  it('clamps the cap to 256 KiB and to at least 1', async () => {
    const s = setup({ kind: 'text', content: 'abc' });
    await s.call(CHANNELS.readText, [SHA, undefined, 10 ** 9]);
    await s.call(CHANNELS.readText, [SHA, undefined, 0]);
    expect(s.blob.ranges).toEqual([{ start: 0, end: 2 }, { start: 0, end: 1 }]);
    const big = setup({ kind: 'text', content: 'x'.repeat(300 * 1024) });
    const r = await big.call(CHANNELS.readText, [SHA, undefined, 10 ** 9]);
    expect(r.value.text.length).toBe(256 * 1024);
    expect(r.value.truncated).toBe(true);
  });
  it('decodes invalid UTF-8 with replacement characters', async () => {
    const s = setup({ kind: 'text', content: 'a' });
    s.blob.size = 2;
    s.blob.stream = () => Readable.from([Buffer.from([0x61, 0xff])]);
    expect((await s.call(CHANNELS.readText, [SHA, undefined, 10])).value.text).toBe('a\ufffd');
  });
  it('refuses other kinds, bad arguments and damaged files', async () => {
    for (const kind of ['image', 'html', 'svg', 'executable', 'pdf'] as const) {
      const s = setup({ kind });
      expect((await s.call(CHANNELS.readText, [SHA, undefined, 10])).error.code, kind).toBe('validation');
      expect(s.blob.closed).toBe(1);
    }
    const s = setup({ kind: 'text' });
    for (const args of [[SHA], [SHA, undefined, 'x'], [SHA, undefined, NaN], ['abc', undefined, 10], [SHA, 7, 10]])
      expect((await s.call(CHANNELS.readText, args)).error.code, JSON.stringify(args)).toBe('validation');
    const bad = setup({ open: err('corrupt', 'This attachment is damaged.') });
    expect((await bad.call(CHANNELS.readText, [SHA, undefined, 10])).error.code).toBe('corrupt');
  });
  it('an empty file is an empty string', async () => {
    const s = setup({ kind: 'text', content: '' });
    expect((await s.call(CHANNELS.readText, [SHA, undefined, 10])).value).toEqual({ text: '', truncated: false });
  });
});
