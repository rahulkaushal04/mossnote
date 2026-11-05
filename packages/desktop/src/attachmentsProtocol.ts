import { ATTACHMENT_SCHEME, parseAttachmentUrl, type VerifiedBlob } from '@mossnote/core';
import type { AppError, Result } from '@mossnote/core';
import { Readable } from 'node:stream';

/** Registered before app ready. Not bypassCSP: the app page CSP must still allow the scheme (img-src, media-src). */
export const ATTACHMENT_PRIVILEGES = {
  scheme: ATTACHMENT_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
} as const;

/** This policy is the response's own; the app page CSP header is never rewritten (M3). */
export const ATTACHMENT_CSP = "sandbox; default-src 'none'";

export interface AttachmentHost {
  openVerified(sha: string): Promise<Result<VerifiedBlob>>;
}
export interface ProtocolRequest {
  url: string;
  method: string;
  headers: { get(name: string): string | null };
  signal?: AbortSignal;
}

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'unsatisfiable' };

/**
 * Single byte range per RFC 9110. Anything unparseable or with several ranges is ignored (200, whole file);
 * a start beyond the end, `bytes=-0` and any range on an empty file are 416.
 */
export function parseRange(header: string | null, size: number): RangeResult {
  if (header === null) return { kind: 'full' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'full' };
  if (size === 0) return { kind: 'unsatisfiable' };
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return { kind: 'unsatisfiable' };
    return { kind: 'range', start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Number(m[2]);
  if (m[2] !== '' && end < start) return { kind: 'full' }; // invalid, so ignored
  if (start >= size) return { kind: 'unsatisfiable' };
  return { kind: 'range', start, end: Math.min(end, size - 1) };
}

const SAFE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': ATTACHMENT_CSP,
  'Cache-Control': 'no-store', // a file that is damaged later must not keep being served from cache
} as const;

const empty = (status: number, extra: Record<string, string> = {}) =>
  new Response(null, { status, headers: { ...SAFE_HEADERS, ...extra } });

/** What a failed open means to the page; the body is always empty and never names a path. */
function statusFor(e: AppError): number {
  if (e.code === 'not_found') return 404;
  if (e.code === 'corrupt')
    return (e.cause as { attachmentState?: string } | undefined)?.attachmentState === 'missing'
      ? 404
      : 409;
  return 500;
}

/** Kinds that are never rendered by the page: sent as a download of opaque bytes. */
const DOWNLOAD_KINDS = new Set(['executable', 'other', 'html']);

export function createAttachmentHandler(
  host: () => AttachmentHost | undefined,
): (req: ProtocolRequest) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return empty(405, { Allow: 'GET, HEAD' });
    const sha = parseAttachmentUrl(req.url);
    const h = host();
    if (!sha || !h) return empty(404);
    let opened: Result<VerifiedBlob>;
    try {
      opened = await h.openVerified(sha);
    } catch {
      return empty(500);
    }
    if (!opened.ok) return empty(statusFor(opened.error));
    const blob = opened.value;
    let closed = false;
    const release = () => {
      if (!closed) {
        closed = true;
        blob.close();
      }
    };
    try {
      const range = parseRange(req.headers.get('range'), blob.size);
      const download = DOWNLOAD_KINDS.has(blob.kind);
      const headers: Record<string, string> = {
        ...SAFE_HEADERS,
        'Content-Type': download ? 'application/octet-stream' : blob.mime,
        'Accept-Ranges': 'bytes',
        ...(download ? { 'Content-Disposition': 'attachment' } : {}),
      };
      if (range.kind === 'unsatisfiable') {
        release();
        return empty(416, { 'Content-Range': `bytes */${blob.size}` });
      }
      const part = range.kind === 'range' ? range : { start: 0, end: blob.size - 1 };
      const length = blob.size === 0 ? 0 : part.end - part.start + 1;
      headers['Content-Length'] = String(length);
      if (range.kind === 'range')
        headers['Content-Range'] = `bytes ${part.start}-${part.end}/${blob.size}`;
      const status = range.kind === 'range' ? 206 : 200;
      if (req.method === 'HEAD' || length === 0) {
        release();
        return new Response(null, { status, headers });
      }
      const node = blob.stream(part);
      node.once('close', release); // end, error and consumer cancel all destroy the stream
      req.signal?.addEventListener('abort', () => node.destroy(), { once: true });
      return new Response(Readable.toWeb(node) as unknown as ReadableStream, { status, headers });
    } catch {
      release();
      return empty(500);
    }
  };
}
