import { describe, expect, it } from 'vitest';
import { escapeMarkdownLabel, extensionOf, sanitizeName } from '../../src/attachments/names.ts';

describe('AT-4 filename sanitization', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system32\\cmd.exe', 'cmd.exe'],
    ['/abs/path/report.pdf', 'report.pdf'],
    ['.hidden', 'hidden'],
    ['...', 'attachment'],
    ['', 'attachment'],
    ['   ', 'attachment'],
    ['name. . ', 'name'],
    ['a:b.txt', 'a_b.txt'],
    ['we<ird>|"?*.txt', 'we_ird_____.txt'],
    ['tab\there\u0000nul\u0007bell.txt', 'tabherenulbell.txt'],
    ['C1\u0085control\u009f.txt', 'C1control.txt'],
  ])('%j -> %j', (raw, want) => {
    expect(sanitizeName(raw)).toBe(want);
  });

  it('removes bidi overrides so an extension cannot be disguised', () => {
    const evil = 'evil‮txt.exe';
    const out = sanitizeName(evil);
    expect(out).toBe('eviltxt.exe');
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(sanitizeName('x⁦y⁩z.png')).toBe('xyz.png');
  });

  it('prefixes Windows reserved names', () => {
    expect(sanitizeName('CON')).toBe('_CON');
    expect(sanitizeName('nul.txt')).toBe('_nul.txt');
    expect(sanitizeName('COM1.log')).toBe('_COM1.log');
    expect(sanitizeName('console.txt')).toBe('console.txt');
  });

  it('is NFC and caps at 200 UTF-8 bytes while keeping the extension', () => {
    expect(sanitizeName('café.txt')).toBe('café.txt');
    const long = sanitizeName(`${'a'.repeat(300)}.pdf`);
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(200);
    expect(long.endsWith('.pdf')).toBe(true);
    const wide = sanitizeName(`${'日'.repeat(100)}.png`); // 3 bytes each
    expect(Buffer.byteLength(wide)).toBeLessThanOrEqual(200);
    expect(wide.endsWith('.png')).toBe(true);
    expect(wide).not.toContain('�');
  });

  it('is idempotent', () => {
    for (const raw of ['../a b.txt', 'evil‮txt.exe', 'CON', 'x'.repeat(400)]) {
      const once = sanitizeName(raw);
      expect(sanitizeName(once)).toBe(once);
    }
  });

  it('extensionOf', () => {
    expect(extensionOf('a.PDF')).toBe('.pdf');
    expect(extensionOf('archive.tar.gz')).toBe('.gz');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.bashrc')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });

  it('escapes markdown label metacharacters', () => {
    expect(escapeMarkdownLabel('a](http://evil)[b')).toBe('a\\]\\(http://evil\\)\\[b');
    expect(escapeMarkdownLabel('*x* _y_ `z` <b> !')).toBe('\\*x\\* \\_y\\_ \\`z\\` \\<b\\> \\!');
  });
});
