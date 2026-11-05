import { extensionOf } from './names.ts';
import type { Kind } from './types.ts';

/** How many leading bytes the sniffer needs. */
export const SNIFF_BYTES = 4096;

export interface Sniffed {
  mime: string;
  kind: Kind;
}

/**
 * Extensions that make a file reveal-only whatever its bytes look like (AT-4, minor 13). The
 * extension is trusted ONLY to upgrade a file to 'executable', never to downgrade it.
 */
export const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set(
  (
    '.inetloc .url .afploc .terminal .fileloc .webloc .command .tool .action .workflow .prefpane ' +
    '.kext .dmg .pkg .app .exe .bat .cmd .com .scr .msi .dll .sh .bash .zsh .csh .fish .ps1 .vbs ' +
    '.vbe .wsf .hta .js .jse .mjs .cjs .py .pyc .rb .pl .php .scpt .scptd .applescript .jar .class ' +
    '.lnk .desktop .appimage .deb .rpm .apk .ipa .bin .run .so .dylib .reg .swf .iso'
  ).split(' '),
);

const at = (b: Uint8Array, i: number, ...v: number[]): boolean => v.every((x, k) => b[i + k] === x);
const ascii = (b: Uint8Array, i: number, s: string): boolean =>
  [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

const DIB_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);

function binary(b: Uint8Array): Sniffed | undefined {
  // Executables first: a renamed binary must never be classified as something previewable.
  if (
    at(b, 0, 0xfe, 0xed, 0xfa, 0xce) ||
    at(b, 0, 0xfe, 0xed, 0xfa, 0xcf) ||
    at(b, 0, 0xce, 0xfa, 0xed, 0xfe) ||
    at(b, 0, 0xcf, 0xfa, 0xed, 0xfe) ||
    at(b, 0, 0xca, 0xfe, 0xba, 0xbe) ||
    at(b, 0, 0x7f, 0x45, 0x4c, 0x46) ||
    ascii(b, 0, 'MZ') ||
    ascii(b, 0, '#!')
  )
    return { mime: 'application/octet-stream', kind: 'executable' };
  if (at(b, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: 'image/png', kind: 'image' };
  if (at(b, 0, 0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', kind: 'image' };
  if (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')) return { mime: 'image/gif', kind: 'image' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return { mime: 'image/webp', kind: 'image' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return { mime: 'audio/wav', kind: 'audio' };
  if (ascii(b, 0, 'BM') && at(b, 6, 0, 0, 0, 0) && DIB_SIZES.has(b[14]! | (b[15]! << 8)) && b.length > 18)
    return { mime: 'image/bmp', kind: 'image' };
  if (ascii(b, 0, '%PDF-')) return { mime: 'application/pdf', kind: 'pdf' };
  if (ascii(b, 0, 'ID3') || at(b, 0, 0xff, 0xfb) || at(b, 0, 0xff, 0xf3) || at(b, 0, 0xff, 0xf2))
    return { mime: 'audio/mpeg', kind: 'audio' };
  if (ascii(b, 0, 'OggS')) return { mime: 'audio/ogg', kind: 'audio' };
  if (ascii(b, 0, 'fLaC')) return { mime: 'audio/flac', kind: 'audio' };
  if (at(b, 0, 0x1a, 0x45, 0xdf, 0xa3)) return { mime: 'video/webm', kind: 'video' };
  if (ascii(b, 4, 'ftyp')) {
    if (ascii(b, 8, 'M4A ')) return { mime: 'audio/mp4', kind: 'audio' };
    if (ascii(b, 8, 'qt  ')) return { mime: 'video/quicktime', kind: 'video' };
    return { mime: 'video/mp4', kind: 'video' };
  }
  if (ascii(b, 0, 'PK') && (at(b, 2, 3, 4) || at(b, 2, 5, 6)))
    return { mime: 'application/zip', kind: 'other' };
  return undefined;
}

const SVG = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>/]/i;
const HTML = /^\s*(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>]|<iframe[\s>]|<meta[\s>])/i;

function utf8Text(b: Uint8Array): string | undefined {
  if (b.includes(0)) return undefined;
  try {
    // stream:true tolerates a multi-byte character cut by the 4 KiB window.
    return new TextDecoder('utf-8', { fatal: true }).decode(b, { stream: true });
  } catch {
    return undefined;
  }
}

/**
 * Type from the leading bytes (never from the claimed type). `name` is only used to upgrade to
 * 'executable'. Never throws.
 */
export function sniff(head: Uint8Array, name = ''): Sniffed {
  const b = head.subarray(0, SNIFF_BYTES);
  let out = binary(b);
  if (!out) {
    const t = utf8Text(b);
    if (t === undefined) out = { mime: 'application/octet-stream', kind: 'other' };
    else {
      const s = t.replace(/^﻿/, '');
      if (SVG.test(s)) out = { mime: 'image/svg+xml', kind: 'svg' };
      else if (HTML.test(s)) out = { mime: 'text/html', kind: 'html' };
      else out = { mime: 'text/plain', kind: 'text' };
    }
  }
  if (out.kind !== 'executable' && EXECUTABLE_EXTENSIONS.has(extensionOf(name)))
    return { mime: 'application/octet-stream', kind: 'executable' };
  return out;
}
