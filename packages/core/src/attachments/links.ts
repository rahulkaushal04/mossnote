import { escapeMarkdownLabel } from './names.ts';
import type { Kind } from './types.ts';

/** The one URL scheme for attachments inside note text. The desktop stage serves it (hash-verified). */
export const ATTACHMENT_SCHEME = 'mossnote-attachment';
export const attachmentUrl = (sha256: string): string => `${ATTACHMENT_SCHEME}://a/${sha256}`;

const URL_RE = /mossnote-attachment:\/\/a\/([0-9a-f]{64})(?![0-9a-f])/g;
const EXACT_RE = /^mossnote-attachment:\/\/a\/([0-9a-f]{64})$/;

/** The sha256 of an attachment URL, only for the exact canonical form (lowercase hex, no extras). */
export const parseAttachmentUrl = (url: string): string | undefined => EXACT_RE.exec(url)?.[1];

/** `![name](url)` for images and SVG, `[name](url)` otherwise. */
export function markdownFor(name: string, sha256: string, kind: Kind): string {
  const label = escapeMarkdownLabel(name);
  const link = `[${label}](${attachmentUrl(sha256)})`;
  return kind === 'image' || kind === 'svg' ? `!${link}` : link;
}

/** Every distinct attachment sha256 mentioned as an attachment URL in `text`. */
export function attachmentShasIn(text: string): string[] {
  return [...new Set([...text.matchAll(URL_RE)].map((m) => m[1]!))];
}

/** Percent-encodes what would end a Markdown destination, keeping `/` and `.` readable. */
const encodeDest = (p: string): string =>
  encodeURI(p).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));

/**
 * Export: replaces `mossnote-attachment://a/<sha>` by the relative path `map` gives for that sha.
 * A sha with no entry is left untouched and reported in `missing` (the caller decides whether to warn).
 */
export function rewriteToRelative(
  text: string,
  map: ReadonlyMap<string, string>,
): { text: string; used: string[]; missing: string[] } {
  const used = new Set<string>();
  const missing = new Set<string>();
  const out = text.replace(URL_RE, (all, sha: string) => {
    const rel = map.get(sha);
    if (rel === undefined) {
      missing.add(sha);
      return all;
    }
    used.add(sha);
    return encodeDest(rel);
  });
  return { text: out, used: [...used], missing: [...missing] };
}

// A Markdown link destination: `](dest` where dest is <...> or has no spaces/parens.
const DEST_RE = /(\]\()(<[^<>\n]*>|[^()\s<>]+)/g;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Import: for each relative link destination the resolver is asked "which attachment is this file?".
 * The resolver owns the hash check and returns the verified sha256 (or undefined to leave the link
 * alone). Absolute paths, schemes and fragments never reach it.
 */
export function rewriteFromRelative(
  text: string,
  resolver: (relativePath: string) => string | undefined,
): { text: string; replaced: string[] } {
  const replaced = new Set<string>();
  const out = text.replace(DEST_RE, (all, open: string, dest: string) => {
    const raw = dest.startsWith('<') ? dest.slice(1, -1) : dest;
    if (raw === '' || raw.startsWith('/') || raw.startsWith('#') || SCHEME_RE.test(raw)) return all;
    let decoded: string;
    try {
      decoded = decodeURI(raw);
    } catch {
      return all;
    }
    const sha = resolver(decoded);
    if (!sha || !/^[0-9a-f]{64}$/.test(sha)) return all;
    replaced.add(sha);
    return open + attachmentUrl(sha);
  });
  return { text: out, replaced: [...replaced] };
}
