import { REMOTE_LIMITS } from '@mossnote/core';
import { describe, expect, it } from 'vitest';
import { loadRemoteImage, type RemoteDeps, type RemoteResponse } from './remoteImage.ts';

// Smallest valid-looking PNG header: signature + IHDR with the given size.
function png(w = 2, h = 2, extra = 0): Buffer {
  const b = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

type Reply = { status?: number; headers?: Record<string, string>; chunks?: Buffer[] };
function fake(opts: {
  dns: Record<string, string[][]>; // successive answers per host
  replies: Reply[];
  timeoutMs?: number;
}) {
  const asked: string[] = [];
  const connected: { host: string; address: string }[] = [];
  const destroyed: number[] = [];
  const dnsCalls: Record<string, number> = {};
  let i = 0;
  const deps: RemoteDeps = {
    timeoutMs: opts.timeoutMs,
    async resolve(host) {
      asked.push(host);
      const answers = opts.dns[host];
      if (!answers) throw new Error('ENOTFOUND');
      const n = dnsCalls[host] ?? 0;
      dnsCalls[host] = n + 1;
      return answers[Math.min(n, answers.length - 1)]!;
    },
    async request(url, address) {
      connected.push({ host: url.hostname, address });
      const r = opts.replies[i++] ?? {};
      const idx = i;
      const res: RemoteResponse = {
        status: r.status ?? 200,
        headers: r.headers ?? { 'content-type': 'image/png' },
        body: (async function* () {
          for (const c of r.chunks ?? [png()]) yield c;
        })(),
        destroy: () => void destroyed.push(idx),
      };
      return res;
    },
  };
  return { deps, asked, connected, destroyed };
}
const pub = '93.184.216.34';

describe('remote image loader (AT-10, M2)', () => {
  it('loads a public https image as a data: URL, connected to the validated address', async () => {
    const f = fake({ dns: { 'img.example': [[pub]] }, replies: [{}] });
    const r = await loadRemoteImage('https://img.example/a.png', f.deps);
    expect(r).toEqual({ ok: true, dataUrl: `data:image/png;base64,${png().toString('base64')}` });
    expect(f.connected).toEqual([{ host: 'img.example', address: pub }]);
  });

  it('refuses http, credentials, odd ports and private literals before any DNS or request', async () => {
    const f = fake({ dns: {}, replies: [] });
    for (const u of [
      'http://img.example/a.png',
      'https://u:p@img.example/a.png',
      'https://img.example:8443/a.png',
      'https://127.0.0.1/a.png',
      'https://[::1]/a.png',
      'https://localhost/a.png',
      'not a url',
    ])
      expect((await loadRemoteImage(u, f.deps)).ok, u).toBe(false);
    expect(f.asked).toEqual([]);
    expect(f.connected).toEqual([]);
  });

  it('refuses a host that resolves to a private address, or to a mix with one', async () => {
    for (const answer of [['10.0.0.5'], ['169.254.169.254'], [pub, '127.0.0.1'], ['::ffff:127.0.0.1'], []]) {
      const f = fake({ dns: { 'evil.example': [answer] }, replies: [{}] });
      const r = await loadRemoteImage('https://evil.example/a.png', f.deps);
      expect(r.ok, answer.join()).toBe(false);
      expect(f.connected, answer.join()).toEqual([]);
    }
  });

  it('DNS rebinding: the connection uses the address that was validated, and a changed second answer is not trusted', async () => {
    // First answer public (validated and pinned); a later lookup would be private. Only one lookup per hop is made.
    const f = fake({ dns: { 'rebind.example': [[pub], ['127.0.0.1']] }, replies: [{}] });
    const r = await loadRemoteImage('https://rebind.example/a.png', f.deps);
    expect(r.ok).toBe(true);
    expect(f.asked).toEqual(['rebind.example']);
    expect(f.connected[0]!.address).toBe(pub);
    // Rebinding between hops: the redirect target is resolved again and the private answer is refused.
    const g = fake({
      dns: { 'a.example': [[pub]], 'b.example': [['127.0.0.1']] },
      replies: [{ status: 302, headers: { location: 'https://b.example/x.png' } }, {}],
    });
    const r2 = await loadRemoteImage('https://a.example/a.png', g.deps);
    expect(r2.ok).toBe(false);
    expect(g.connected.map((c) => c.host)).toEqual(['a.example']);
  });

  it('follows a public redirect, re-validating each hop, and stops at the hop budget', async () => {
    const f = fake({
      dns: { 'a.example': [[pub]], 'b.example': [[pub]] },
      replies: [{ status: 301, headers: { location: 'https://b.example/y.png' } }, {}],
    });
    expect((await loadRemoteImage('https://a.example/x.png', f.deps)).ok).toBe(true);
    expect(f.connected.map((c) => c.host)).toEqual(['a.example', 'b.example']);
    expect(f.destroyed).toEqual([1, 2]); // the redirect response was dropped unread, then the final one closed

    const loop = fake({
      dns: { 'a.example': [[pub]] },
      replies: Array.from({ length: 6 }, () => ({
        status: 302,
        headers: { location: 'https://a.example/next' },
      })),
    });
    const r = await loadRemoteImage('https://a.example/x.png', loop.deps);
    expect(r.ok).toBe(false);
    expect(loop.connected).toHaveLength(REMOTE_LIMITS.maxRedirects + 1);
  });

  it('refuses a redirect to 127.0.0.1, to http, and to a missing Location', async () => {
    for (const location of ['https://127.0.0.1/x.png', 'http://a.example/x.png', 'https://[::1]/x.png', undefined]) {
      const f = fake({
        dns: { 'a.example': [[pub]] },
        replies: [{ status: 302, headers: location ? { location } : {} }, {}],
      });
      const r = await loadRemoteImage('https://a.example/x.png', f.deps);
      expect(r.ok, String(location)).toBe(false);
      expect(f.connected, String(location)).toHaveLength(1);
    }
  });

  it('refuses a body over the size cap while streaming, and a declared oversize length', async () => {
    const big = Buffer.alloc(REMOTE_LIMITS.maxBytes);
    const f = fake({ dns: { 'i.example': [[pub]] }, replies: [{ chunks: [png(), big] }] });
    const r = await loadRemoteImage('https://i.example/a.png', f.deps);
    expect(r).toMatchObject({ ok: false, error: { message: expect.stringContaining('too large') } });
    expect(f.destroyed).toEqual([1]);
    const g = fake({
      dns: { 'i.example': [[pub]] },
      replies: [{ headers: { 'content-type': 'image/png', 'content-length': String(REMOTE_LIMITS.maxBytes + 1) } }],
    });
    expect((await loadRemoteImage('https://i.example/a.png', g.deps)).ok).toBe(false);
  });

  it('refuses wrong content types (svg, html), non-200, and bytes that are not an image', async () => {
    for (const reply of [
      { headers: { 'content-type': 'image/svg+xml' } },
      { headers: { 'content-type': 'text/html' } },
      { headers: {} },
      { status: 404 },
      { chunks: [Buffer.from('<html>not an image</html>')] },
    ] as Reply[]) {
      const f = fake({ dns: { 'i.example': [[pub]] }, replies: [reply] });
      expect((await loadRemoteImage('https://i.example/a.png', f.deps)).ok, JSON.stringify(reply)).toBe(false);
    }
  });

  it('refuses an image over the pixel cap', async () => {
    const f = fake({ dns: { 'i.example': [[pub]] }, replies: [{ chunks: [png(20_000, 20_000)] }] });
    expect((await loadRemoteImage('https://i.example/a.png', f.deps)).ok).toBe(false);
  });

  it('reports a request that never answers as unavailable after the timeout', async () => {
    const f = fake({ dns: { 'i.example': [[pub]] }, replies: [], timeoutMs: 20 });
    f.deps.request = (_u, _a, signal) =>
      new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
    const r = await loadRemoteImage('https://i.example/a.png', f.deps);
    expect(r).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  it('a DNS failure is an error, not a throw', async () => {
    const f = fake({ dns: {}, replies: [] });
    expect((await loadRemoteImage('https://nx.example/a.png', f.deps)).ok).toBe(false);
  });
});
