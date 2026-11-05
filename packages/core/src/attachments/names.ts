/** File names are untrusted text (AT-4). Everything shown or exported goes through sanitizeName. */

const MAX_BYTES = 200;
// C0/C1 controls, bidi overrides/isolates and marks, zero-width characters, BOM.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩؜﻿]/g;
const WINDOWS_BAD = /[<>"|?*:]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const byteLen = (s: string): number => Buffer.byteLength(s, 'utf8');

/** Cuts to `max` UTF-8 bytes on a code point boundary. */
function cutBytes(s: string, max: number): string {
  let out = '';
  let n = 0;
  for (const ch of s) {
    const b = byteLen(ch);
    if (n + b > max) break;
    out += ch;
    n += b;
  }
  return out;
}

/** Last extension (with dot, lowercased) of a sanitized name, or ''. */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i).toLowerCase() : '';
}

/**
 * A safe display and export name: NFC; only the last path segment; no controls, bidi overrides or
 * separators; no leading dots (hidden files, `..`); no trailing dots or spaces; Windows reserved names
 * prefixed; at most 200 UTF-8 bytes with the extension kept; never empty.
 */
export function sanitizeName(raw: string): string {
  let s = String(raw).normalize('NFC');
  s = s.split(/[\\/]/).pop() ?? '';
  s = s.replace(INVISIBLE, '').replace(WINDOWS_BAD, '_');
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (s === '') return 'attachment';
  if (RESERVED.test(s.split('.')[0] ?? '')) s = `_${s}`;
  if (byteLen(s) > MAX_BYTES) {
    const ext = extensionOf(s);
    const keep = ext && byteLen(ext) <= 20 ? ext : '';
    const base = keep ? s.slice(0, s.length - keep.length) : s;
    s = (cutBytes(base, MAX_BYTES - byteLen(keep)).replace(/[.\s]+$/, '') || 'attachment') + keep;
  }
  return s;
}

/** Escapes link-label text so a name cannot break out of `[label](url)`. */
export const escapeMarkdownLabel = (s: string): string => s.replace(/[\\[\]()<>`*_!&~|]/g, '\\$&');
