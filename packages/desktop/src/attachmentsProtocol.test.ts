import { err, ok, type Result, type VerifiedBlob } from '@mossnote/core';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_CSP,
  ATTACHMENT_PRIVILEGES,
  createAttachmentHandler,
  parseRange,
} from './attachmentsProtocol.ts';

const SHA = 'c'.repeat(64);
const url = `mossnote-attachment://a/${SHA}`;
const bytes = Buffer.from('0123456789'); // size 10

function setup(o: { kind?: VerifiedBlob['kind']; mime?: string; data?: Buffer; open?: Result<VerifiedBlob> } = {}) {
  const data = o.data ?? bytes;
  const state = { closed: 0, ranges: [] as unknown[], streams: [] as Readable[] };
  const blob: VerifiedBlob = {
    sha256: SHA,
    size: data.length,
    mime: o.mime ?? 'image/png',
    kind: o.kind ?? 'image',
    path: '/very/secret/path',
    stream: (r) => {
      state.ranges.push(r);
      const s = Readable.from([data.subarray(r?.start ?? 0, (r?.end ?? data.length - 1) + 1)]);
      state.streams.push(s);
      return s;
    },
    close: () => void state.closed++,
  };
  const calls: string[] = [];
  const handler = createAttachmentHandler(() => ({
    openVerified: async (sha) => (calls.push(sha), o.open ?? ok(blob)),
  }));
  const get = (range?: string, method = 'GET', u = url, signal?: AbortSignal) =>
    handler({
      url: u,
      method,
      headers: { get: (n) => (n.toLowerCase() === 'range' ? (range ?? null) : null) },
      signal,
    });
  return { get, state, calls };
}
const text = async (r: Response) => Buffer.from(await r.arrayBuffer()).toString();
const closed = () => new Promise((r) => setImmediate(r));

describe('registration', () => {
  it('is privileged without bypassCSP', () => {
    expect(ATTACHMENT_PRIVILEGES.scheme).toBe('mossnote-attachment');
    expect(ATTACHMENT_PRIVILEGES.privileges).toEqual({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    });
    expect(ATTACHMENT_PRIVILEGES.privileges).not.toHaveProperty('bypassCSP');
  });
});

describe('protocol responses (AT-4, AT-5)', () => {
  it('serves the verified bytes with safe headers, closes the handle, never sends the path', async () => {
    const s = setup();
    const r = await s.get();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('content-length')).toBe('10');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toBe(ATTACHMENT_CSP);
    expect(ATTACHMENT_CSP).toBe("sandbox; default-src 'none'");
    expect(r.headers.get('content-disposition')).toBeNull();
    expect(await text(r)).toBe('0123456789');
    await closed();
    expect(s.state.closed).toBe(1);
    expect(JSON.stringify([...r.headers])).not.toContain('secret');
  });

  it.each(['executable', 'other', 'html'] as const)('serves %s as an octet-stream download', async (kind) => {
    const s = setup({ kind, mime: 'text/html' });
    const r = await s.get();
    expect(r.headers.get('content-type')).toBe('application/octet-stream');
    expect(r.headers.get('content-disposition')).toBe('attachment');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    await text(r);
  });

  it('serves SVG as an image with the sandbox policy and nosniff', async () => {
    const s = setup({ kind: 'svg', mime: 'image/svg+xml' });
    const r = await s.get();
    expect(r.headers.get('content-type')).toBe('image/svg+xml');
    expect(r.headers.get('content-security-policy')).toBe(ATTACHMENT_CSP);
    await text(r);
  });

  it('answers 404 for non-canonical URLs without opening anything', async () => {
    const s = setup();
    for (const u of [
      `${url}?x=1`,
      `${url}/`,
      `mossnote-attachment://b/${SHA}`,
      `mossnote-attachment://a/${SHA.toUpperCase()}`,
      `mossnote-attachment://a/${'c'.repeat(63)}`,
      `mossnote-attachment://a/../${SHA}`,
    ]) {
      const r = await s.get(undefined, 'GET', u);
      expect(r.status, u).toBe(404);
      expect(await text(r)).toBe('');
    }
    expect(s.calls).toEqual([]);
  });

  it('rejects other methods with 405', async () => {
    const s = setup();
    for (const m of ['POST', 'PUT', 'DELETE']) expect((await s.get(undefined, m)).status).toBe(405);
    expect(s.calls).toEqual([]);
  });

  it('maps open failures to 404 / 409 / 500 with an empty body and no handle left open', async () => {
    const cases: [Result<VerifiedBlob>, number][] = [
      [err('not_found', 'x'), 404],
      [err('corrupt', 'x', { attachmentState: 'missing', sha256: SHA }), 404],
      [err('corrupt', 'x', { attachmentState: 'corrupt', sha256: SHA }), 409],
      [err('io', 'x'), 500],
    ];
    for (const [open, status] of cases) {
      const r = await setup({ open }).get();
      expect(r.status).toBe(status);
      expect(await text(r)).toBe('');
      expect(r.headers.get('content-security-policy')).toBe(ATTACHMENT_CSP);
    }
  });

  it('HEAD sends headers only and closes the handle at once', async () => {
    const s = setup();
    const r = await s.get(undefined, 'HEAD');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-length')).toBe('10');
    expect(await text(r)).toBe('');
    expect(s.state.closed).toBe(1);
    expect(s.state.ranges).toEqual([]);
  });

  it('closes the handle when the consumer cancels, and when the request aborts', async () => {
    const s = setup({ data: Buffer.alloc(1024 * 1024) });
    const r = await s.get();
    await r.body!.cancel();
    await closed();
    expect(s.state.closed).toBe(1);
    const ac = new AbortController();
    const s2 = setup({ data: Buffer.alloc(1024 * 1024) });
    await s2.get(undefined, 'GET', url, ac.signal);
    ac.abort();
    await closed();
    expect(s2.state.streams[0]!.destroyed).toBe(true);
    expect(s2.state.closed).toBe(1);
  });

  it('an empty file is a 200 with no body and a closed handle', async () => {
    const s = setup({ data: Buffer.alloc(0) });
    const r = await s.get();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-length')).toBe('0');
    expect(s.state.closed).toBe(1);
    expect((await s.get('bytes=0-0')).status).toBe(416);
  });
});

describe('Range (media seeking)', () => {
  it.each<[string, number, string, string]>([
    ['bytes=2-5', 206, '2345', 'bytes 2-5/10'],
    ['bytes=7-', 206, '789', 'bytes 7-9/10'],
    ['bytes=-3', 206, '789', 'bytes 7-9/10'],
    ['bytes=-100', 206, '0123456789', 'bytes 0-9/10'], // suffix longer than the file
    ['bytes=5-999999999999999999999', 206, '56789', 'bytes 5-9/10'], // overflow end is clamped
    ['bytes=0-0', 206, '0', 'bytes 0-0/10'],
    ['bytes=9-9', 206, '9', 'bytes 9-9/10'],
  ])('%s -> %i', async (range, status, body, cr) => {
    const s = setup();
    const r = await s.get(range);
    expect(r.status).toBe(status);
    expect(r.headers.get('content-range')).toBe(cr);
    expect(r.headers.get('content-length')).toBe(String(body.length));
    expect(await text(r)).toBe(body);
  });

  it.each(['bytes=10-', 'bytes=10-20', 'bytes=-0', 'bytes=99999999999999999999-', 'bytes=11-12'])(
    '%s -> 416 with Content-Range */size, no body, handle closed',
    async (range) => {
      const s = setup();
      const r = await s.get(range);
      expect(r.status).toBe(416);
      expect(r.headers.get('content-range')).toBe('bytes */10');
      expect(await text(r)).toBe('');
      expect(s.state.closed).toBe(1);
      expect(s.state.ranges).toEqual([]);
    },
  );

  it.each(['bytes=0-1,4-5', 'bytes=5-2', 'bytes=-', 'bytes=a-b', 'items=0-1', 'bytes=0-1,', ''])(
    'ignores %j (multiple, inverted or malformed): full 200',
    async (range) => {
      const s = setup();
      const r = await s.get(range);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-range')).toBeNull();
      expect(await text(r)).toBe('0123456789');
    },
  );

  it('parseRange is pure', () => {
    expect(parseRange(null, 10)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=2-3', 10)).toEqual({ kind: 'range', start: 2, end: 3 });
    expect(parseRange('bytes=0-5', 0)).toEqual({ kind: 'unsatisfiable' });
  });
});
