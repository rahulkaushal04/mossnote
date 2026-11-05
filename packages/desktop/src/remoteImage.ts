import {
  checkRedirect,
  checkRemoteResponse,
  checkRemoteUrl,
  isAllowedRemoteAddress,
  REMOTE_LIMITS,
  withinPixelCap,
} from '@mossnote/core';
import dns from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';

type UrlCheck = ReturnType<typeof checkRemoteUrl>;

/** An HTTP response whose body has not been read yet. */
export interface RemoteResponse {
  status: number;
  /** Lowercase header names. */
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}
export interface RemoteDeps {
  /** All addresses of `host` (canonical text). */
  resolve(host: string): Promise<string[]>;
  /** GET `url` over a connection pinned to `address`. No cookies, no credentials, no redirects followed. */
  request(url: URL, address: string, signal: AbortSignal): Promise<RemoteResponse>;
  timeoutMs?: number;
}

export type RemoteResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: { code: 'validation' | 'unavailable'; message: string } };
const fail = (message: string, code: 'validation' | 'unavailable' = 'validation'): RemoteResult => ({
  ok: false,
  error: { code, message },
});

/**
 * Loads one remote image for the user (AT-10, M2): every hop is resolved here, ALL its addresses must be
 * public, and the connection is pinned to the validated address so a second DNS answer cannot redirect it.
 */
export async function loadRemoteImage(raw: string, deps: RemoteDeps): Promise<RemoteResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? REMOTE_LIMITS.timeoutMs);
  let live: RemoteResponse | undefined;
  try {
    let check: UrlCheck = checkRemoteUrl(raw);
    for (let hops = 0; ; hops++) {
      if (!check.ok) return fail(check.reason);
      const { url, host } = check;
      const addresses = isIP(host) ? [host] : await deps.resolve(host);
      // One bad answer among good ones is how rebinding mixes in a private address: refuse the lot.
      const address = addresses[0];
      if (!address || !addresses.every(isAllowedRemoteAddress))
        return fail('This host does not resolve to a public address.');
      live = await deps.request(url, address, ac.signal);
      const res = live;
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        res.destroy();
        const loc = res.headers.location;
        if (!loc) return fail('Invalid redirect.');
        check = checkRedirect(url.toString(), loc, hops);
        continue;
      }
      const len = Number(res.headers['content-length']);
      const verdict = checkRemoteResponse({
        status: res.status,
        contentType: res.headers['content-type'],
        contentLength: res.headers['content-length'] === undefined || Number.isNaN(len) ? null : len,
      });
      if (!verdict.ok) return fail(verdict.reason);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const c of res.body) {
        if (ac.signal.aborted) return fail('The image took too long to load.', 'unavailable');
        total += c.length;
        if (total > REMOTE_LIMITS.maxBytes) return fail('The image is too large.');
        chunks.push(c);
      }
      if (ac.signal.aborted) return fail('The image took too long to load.', 'unavailable');
      const bytes = Buffer.concat(chunks);
      if (!withinPixelCap(bytes)) return fail('The address is not a supported image, or it is too large.');
      const type = res.headers['content-type']!.split(';')[0]!.trim().toLowerCase();
      return { ok: true, dataUrl: `data:${type};base64,${bytes.toString('base64')}` };
    }
  } catch {
    return ac.signal.aborted
      ? fail('The image took too long to load.', 'unavailable')
      : fail('The image could not be loaded.', 'unavailable');
  } finally {
    clearTimeout(timer);
    live?.destroy();
    ac.abort();
  }
}

/** Real network layer: system DNS, then Node https with a lookup that can only return the validated address. */
export const nodeRemoteDeps: RemoteDeps = {
  async resolve(host) {
    return (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  },
  request(url, address, signal) {
    return new Promise((resolve, reject) => {
      const family = isIP(address);
      const req = https.request(
        {
          protocol: 'https:',
          hostname: url.hostname.replace(/^\[|\]$/g, ''), // SNI and certificate check use the real host name
          port: 443,
          path: url.pathname + url.search,
          method: 'GET',
          agent: false, // no connection reuse between hops or users
          signal,
          headers: { Accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp', 'Accept-Encoding': 'identity' },
          lookup: (_h, opts, cb) =>
            (opts as { all?: boolean }).all
              ? (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
                  { address, family },
                ])
              : cb(null, address, family),
        },
        (res) => {
          const headers: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(res.headers))
            headers[k] = Array.isArray(v) ? v[0] : v;
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: res,
            destroy: () => res.destroy(),
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  },
};
