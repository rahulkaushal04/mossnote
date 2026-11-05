/**
 * Single source for the renderer's Content Security Policy. Desktop sends it as a response header and
 * the build injects `CSP_META` into dist/index.html, because header hooks may not cover file: pages.
 * Style `'unsafe-inline'` is needed for CodeMirror's injected style rules; scripts stay `'self'` only.
 */
/** Attachment protocol (images, audio, video only; its responses carry their own `sandbox; default-src 'none'`). */
export const ATTACHMENT_SCHEME = 'mossnote-attachment:';

const directives = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${ATTACHMENT_SCHEME}`,
  `media-src ${ATTACHMENT_SCHEME}`,
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];

/** For the HTTP header / session hook. */
export const CSP = [...directives, "frame-ancestors 'none'"].join('; ');

/** For the <meta> tag: `frame-ancestors` is ignored (and warned about) in meta policies. */
export const CSP_META = directives.join('; ');
