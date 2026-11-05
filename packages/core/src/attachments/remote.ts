import { isIP } from 'node:net';

/**
 * Remote-image fetch POLICY (AT-10, decision M2). Pure functions only: the desktop stage does the
 * networking (isolated session, Node https with a pinned `lookup`, native confirm) and calls these to
 * decide. Nothing here touches the network.
 */

export const REMOTE_LIMITS = {
  /** Largest response body. */
  maxBytes: 5 * 1024 * 1024,
  /** Largest decoded image, in pixels (100 megapixels). */
  maxPixels: 100_000_000,
  timeoutMs: 15_000,
  maxRedirects: 3,
  maxUrlLength: 2048,
} as const;

/** SVG is deliberately absent: a remote SVG is never loaded. */
export const REMOTE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

function parseV4(s: string): number[] | undefined {
  if (isIP(s) !== 4) return undefined;
  return s.split('.').map(Number);
}

/** Expands an IPv6 text address into eight 16-bit groups (embedded dotted IPv4 supported). */
function parseV6(s: string): number[] | undefined {
  if (isIP(s) !== 6) return undefined;
  let t = s.toLowerCase();
  const dot = t.lastIndexOf('.');
  if (dot >= 0) {
    const colon = t.lastIndexOf(':');
    const v4 = parseV4(t.slice(colon + 1));
    if (!v4) return undefined;
    t = `${t.slice(0, colon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const [head = '', tail, extra] = t.split('::');
  if (extra !== undefined) return undefined;
  const h = head === '' ? [] : head.split(':');
  const l = tail === undefined || tail === '' ? [] : tail.split(':');
  const fill = tail === undefined ? 0 : 8 - h.length - l.length;
  if (fill < 0 || (tail === undefined && h.length !== 8)) return undefined;
  const groups = [...h, ...Array<string>(fill).fill('0'), ...l].map((x) => parseInt(x, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : undefined;
}

function v4Allowed([a, b, c]: number[]): boolean {
  const A = a!;
  const B = b!;
  const C = c!;
  if (A === 0 || A === 10 || A === 127) return false; // this-host, private, loopback
  if (A >= 224) return false; // multicast, reserved, broadcast
  if (A === 100 && B >= 64 && B <= 127) return false; // CGNAT (incl. 100.100.100.200 metadata)
  if (A === 169 && B === 254) return false; // link-local, cloud metadata 169.254.169.254
  if (A === 172 && B >= 16 && B <= 31) return false;
  if (A === 192 && B === 168) return false;
  if (A === 192 && B === 0 && (C === 0 || C === 2)) return false; // IETF protocol, TEST-NET-1
  if (A === 192 && B === 88 && C === 99) return false; // 6to4 relay
  if (A === 198 && (B === 18 || B === 19)) return false; // benchmarking
  if (A === 198 && B === 51 && C === 100) return false; // TEST-NET-2
  if (A === 203 && B === 0 && C === 113) return false; // TEST-NET-3
  return true;
}

/**
 * True only for a globally routable unicast address, given in canonical text form (what a resolver
 * returns). Rejects loopback, private, link-local, CGNAT, multicast, documentation, metadata ranges,
 * and IPv6 forms that smuggle an IPv4 (IPv4-mapped, IPv4-compatible,
 * NAT64, 6to4 and Teredo are all refused). Anything unparseable (zone ids, octal, short forms) is refused.
 */
export function isAllowedRemoteAddress(ip: string): boolean {
  if (typeof ip !== 'string' || ip.includes('%')) return false;
  const v4 = parseV4(ip);
  if (v4) return v4Allowed(v4);
  const g = parseV6(ip);
  if (!g) return false;
  // ::ffff:a.b.c.d (IPv4-mapped) is refused outright: a resolver never needs it for a public host, and
  // it is the classic way to smuggle 127.0.0.1 or 169.254.169.254 past an IPv6-only filter.
  if ((g[0]! & 0xe000) !== 0x2000) return false; // only global unicast 2000::/3
  if (g[0] === 0x2002) return false; // 6to4
  if (g[0] === 0x2001 && (g[1]! === 0 || g[1] === 0xdb8 || (g[1]! & 0xfff0) === 0x10)) return false; // Teredo, documentation, ORCHID
  if (g[0] === 0x3fff && (g[1]! & 0xf000) === 0) return false; // documentation
  return true;
}

export type UrlCheck = { ok: true; url: URL; host: string } | { ok: false; reason: string };

/** https only, no credentials, default port, a real host name or a public IP literal, bounded length. */
export function checkRemoteUrl(raw: string): UrlCheck {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > REMOTE_LIMITS.maxUrlLength)
    return { ok: false, reason: 'Invalid address.' };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid address.' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Only https images can be loaded.' };
  if (u.username || u.password) return { ok: false, reason: 'Addresses with credentials are refused.' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'Only the standard https port is allowed.' };
  const host = u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname;
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    return { ok: false, reason: 'This host cannot be loaded.' };
  if (isIP(host) && !isAllowedRemoteAddress(host))
    return { ok: false, reason: 'This address is not on the public internet.' };
  return { ok: true, url: u, host };
}

/** A redirect target: same rules as the first request, relative to the current URL, and a hop budget. */
export function checkRedirect(current: string, location: string, hops: number): UrlCheck {
  if (hops >= REMOTE_LIMITS.maxRedirects) return { ok: false, reason: 'Too many redirects.' };
  let next: string;
  try {
    next = new URL(location, current).toString();
  } catch {
    return { ok: false, reason: 'Invalid redirect.' };
  }
  return checkRemoteUrl(next);
}

export type ResponseCheck = { ok: true } | { ok: false; reason: string };

/** Headers-time verdict. The body is still byte-counted against maxBytes and sniffed by the caller. */
export function checkRemoteResponse(r: {
  status: number;
  contentType: string | null | undefined;
  contentLength?: number | null;
}): ResponseCheck {
  if (r.status !== 200) return { ok: false, reason: `The server answered ${r.status}.` };
  const type = (r.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!REMOTE_IMAGE_TYPES.has(type)) return { ok: false, reason: 'The address is not a supported image.' };
  if (r.contentLength != null && r.contentLength > REMOTE_LIMITS.maxBytes)
    return { ok: false, reason: 'The image is too large.' };
  return { ok: true };
}

/** [width, height] from the image header, or undefined. PNG, GIF, JPEG, WebP, BMP. */
export function imageDimensions(b: Uint8Array): [number, number] | undefined {
  const u16 = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u32 = (i: number) => (b[i]! * 2 ** 24 + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!) >>> 0;
  const l16 = (i: number) => b[i]! | (b[i + 1]! << 8);
  const s = (i: number, t: string) => [...t].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length >= 24 && s(1, 'PNG')) return [u32(16), u32(20)];
  if (b.length >= 10 && s(0, 'GIF8')) return [l16(6), l16(8)];
  if (b.length >= 30 && s(0, 'RIFF') && s(8, 'WEBP')) {
    if (s(12, 'VP8X')) return [1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16))];
    if (s(12, 'VP8L')) {
      const v = (b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)) >>> 0;
      return [(v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1];
    }
    if (s(12, 'VP8 ')) return [l16(26) & 0x3fff, l16(28) & 0x3fff];
    return undefined;
  }
  if (b.length >= 26 && s(0, 'BM')) {
    const w = (b[18]! | (b[19]! << 8) | (b[20]! << 16) | (b[21]! << 24)) | 0;
    const h = (b[22]! | (b[23]! << 8) | (b[24]! << 16) | (b[25]! << 24)) | 0;
    return [Math.abs(w), Math.abs(h)];
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return undefined;
      const m = b[i + 1]!;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [u16(i + 7), u16(i + 5)];
      i += 2 + len;
    }
  }
  return undefined;
}

/** Within the pixel cap? Unknown dimensions answer false (refuse what cannot be measured). */
export function withinPixelCap(b: Uint8Array): boolean {
  const d = imageDimensions(b);
  return !!d && d[0] > 0 && d[1] > 0 && d[0] * d[1] <= REMOTE_LIMITS.maxPixels;
}
