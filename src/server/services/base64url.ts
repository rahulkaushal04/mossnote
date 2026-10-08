/**
 * Base64url text for cursors. Uses `btoa` and `atob` rather than Node's `Buffer`, so it runs
 * unchanged in the browser runtime.
 */

/** Encode text as unpadded base64url. */
export function encodeBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Decode base64url text. Throws when it is not valid base64url or not valid UTF-8. */
export function decodeBase64Url(encoded: string): string {
  const standard = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
