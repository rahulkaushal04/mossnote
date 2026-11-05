import { describe, expect, it } from 'vitest';
import {
  checkRedirect,
  checkRemoteResponse,
  checkRemoteUrl,
  imageDimensions,
  isAllowedRemoteAddress,
  REMOTE_LIMITS,
  withinPixelCap,
} from '../../src/attachments/remote.ts';

describe('AT-10 remote image policy: isAllowedRemoteAddress', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '0.0.0.0', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '169.254.169.254', '169.254.0.1', '100.64.0.1', '100.127.255.255', '100.100.100.200',
    '192.0.0.1', '192.0.2.5', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9',
    '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
  ])('rejects IPv4 %s', (ip) => {
    expect(isAllowedRemoteAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.1.1', '198.17.0.1'])(
    'accepts public IPv4 %s',
    (ip) => {
      expect(isAllowedRemoteAddress(ip)).toBe(true);
    },
  );

  it.each([
    '::1', '::', 'fe80::1', 'fc00::1', 'fd00:ec2::254', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:10.0.0.1', '::ffff:8.8.8.8',
    '::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '2001:db8::1', '2001:10::1', 'fe80::1%en0', '3fff::1',
  ])('rejects IPv6 %s', (ip) => {
    expect(isAllowedRemoteAddress(ip)).toBe(false);
  });

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e'])(
    'accepts public IPv6 %s',
    (ip) => {
      expect(isAllowedRemoteAddress(ip)).toBe(true);
    },
  );

  it.each(['', 'localhost', 'example.com', '127.1', '0177.0.0.1', '2130706433', '0x7f.0.0.1', '1.2.3', '1.2.3.4.5', '1.2.3.256', ' 8.8.8.8', '::1::2', '[::1]'])(
    'rejects what is not a canonical IP: %j',
    (ip) => {
      expect(isAllowedRemoteAddress(ip)).toBe(false);
    },
  );

  it('never throws on odd input', () => {
    for (const v of [undefined, null, 1, {}, [], 'x'.repeat(10_000)])
      expect(isAllowedRemoteAddress(v as unknown as string)).toBe(false);
  });
});

describe('AT-10 remote image policy: urls, redirects, responses', () => {
  it('https only, no credentials, default port, no local names or private literals', () => {
    expect(checkRemoteUrl('https://example.com/a.png')).toMatchObject({ ok: true, host: 'example.com' });
    expect(checkRemoteUrl('https://example.com:443/a.png').ok).toBe(true);
    for (const bad of [
      'http://example.com/a.png',
      'ftp://example.com/a.png',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd',
      'https://user:pw@example.com/a.png',
      'https://example.com:8443/a.png',
      'https://localhost/a.png',
      'https://a.localhost/a.png',
      'https://printer.local/a.png',
      'https://127.0.0.1/a.png',
      'https://[::1]/a.png',
      'https://169.254.169.254/latest/meta-data',
      'https://[::ffff:7f00:1]/a.png',
      'https://10.1.2.3/a.png',
      'not a url',
      '',
      `https://example.com/${'a'.repeat(REMOTE_LIMITS.maxUrlLength)}`,
    ])
      expect(checkRemoteUrl(bad).ok, bad).toBe(false);
    expect(checkRemoteUrl('https://8.8.8.8/a.png').ok).toBe(true);
  });

  it('redirects are re-checked with the same rules and a hop budget', () => {
    expect(checkRedirect('https://a.example/x', '/y.png', 0)).toMatchObject({ ok: true });
    expect(checkRedirect('https://a.example/x', 'https://169.254.169.254/', 0).ok).toBe(false);
    expect(checkRedirect('https://a.example/x', 'http://b.example/', 0).ok).toBe(false);
    expect(checkRedirect('https://a.example/x', 'https://b.example/', REMOTE_LIMITS.maxRedirects).ok).toBe(false);
    expect(checkRedirect('https://a.example/x', 'https://b.example/', REMOTE_LIMITS.maxRedirects - 1).ok).toBe(true);
  });

  it('responses: 200, an allowed image type, declared size within the cap; SVG is never allowed', () => {
    const ok = { status: 200, contentType: 'image/png; charset=binary', contentLength: 1000 };
    expect(checkRemoteResponse(ok).ok).toBe(true);
    expect(checkRemoteResponse({ ...ok, status: 302 }).ok).toBe(false);
    expect(checkRemoteResponse({ ...ok, contentType: 'image/svg+xml' }).ok).toBe(false);
    expect(checkRemoteResponse({ ...ok, contentType: 'text/html' }).ok).toBe(false);
    expect(checkRemoteResponse({ ...ok, contentType: null }).ok).toBe(false);
    expect(checkRemoteResponse({ ...ok, contentLength: REMOTE_LIMITS.maxBytes + 1 }).ok).toBe(false);
    expect(checkRemoteResponse({ ...ok, contentLength: REMOTE_LIMITS.maxBytes }).ok).toBe(true);
    expect(checkRemoteResponse({ status: 200, contentType: 'IMAGE/JPEG' }).ok).toBe(true);
  });

  it('reads dimensions from headers and enforces the pixel cap', () => {
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12, 'latin1');
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageDimensions(png)).toEqual([640, 480]);
    expect(withinPixelCap(png)).toBe(true);
    png.writeUInt32BE(60_000, 16);
    png.writeUInt32BE(60_000, 20);
    expect(withinPixelCap(png)).toBe(false); // the 10 MB PNG of 60k x 60k pixels

    const gif = Buffer.from('GIF89a\u0010\u0000 \u0000', 'latin1');
    expect(imageDimensions(gif)).toEqual([16, 32]);

    // JPEG: SOI, APP0 (len 4), SOF0 with height 100 and width 200
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 100, 0x00, 200, 0x03]);
    expect(imageDimensions(jpg)).toEqual([200, 100]);

    expect(imageDimensions(Buffer.from('not an image'))).toBeUndefined();
    expect(withinPixelCap(Buffer.from('not an image'))).toBe(false); // unmeasurable is refused
  });
});
