import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from './base64url';

describe('base64url', () => {
  it('round-trips plain and non-ASCII text', () => {
    for (const text of ['', 'a', '{"offset":50}', 'café ☕ 日本語']) {
      expect(decodeBase64Url(encodeBase64Url(text))).toBe(text);
    }
  });

  it('matches Node base64url, without padding', () => {
    const text = '{"after":"01J0000000000000000000000A","n":3}';
    expect(encodeBase64Url(text)).toBe(Buffer.from(text).toString('base64url'));
  });

  it('uses the url-safe alphabet', () => {
    expect(encodeBase64Url('ÿþý')).not.toMatch(/[+/=]/);
  });

  it('throws on text that is not base64url', () => {
    expect(() => decodeBase64Url('***')).toThrow();
  });
});
