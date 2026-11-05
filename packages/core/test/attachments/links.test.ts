import { describe, expect, it } from 'vitest';
import {
  attachmentShasIn,
  attachmentUrl,
  markdownFor,
  parseAttachmentUrl,
  rewriteFromRelative,
  rewriteToRelative,
} from '../../src/attachments/links.ts';
import { sha } from './util.ts';

const A = sha('a');
const B = sha('b');

describe('attachment links', () => {
  it('url, parse, markdown', () => {
    expect(attachmentUrl(A)).toBe(`mossnote-attachment://a/${A}`);
    expect(parseAttachmentUrl(attachmentUrl(A))).toBe(A);
    for (const bad of [
      `mossnote-attachment://a/${A.toUpperCase()}`,
      `mossnote-attachment://b/${A}`,
      `mossnote-attachment://a/${A}x`,
      `mossnote-attachment://a/${A}/`,
      `https://a/${A}`,
      `mossnote-attachment://a/${A.slice(1)}`,
    ])
      expect(parseAttachmentUrl(bad), bad).toBeUndefined();
    expect(markdownFor('pic.png', A, 'image')).toBe(`![pic.png](mossnote-attachment://a/${A})`);
    expect(markdownFor('a.svg', A, 'svg').startsWith('![')).toBe(true);
    expect(markdownFor('doc.pdf', A, 'pdf')).toBe(`[doc.pdf](mossnote-attachment://a/${A})`);
    expect(markdownFor('x](evil)', A, 'other')).toBe(`[x\\]\\(evil\\)](mossnote-attachment://a/${A})`);
  });

  it('attachmentShasIn finds distinct shas, not longer hex runs', () => {
    const t = `![x](${attachmentUrl(A)}) and [y](${attachmentUrl(A)}) [z](${attachmentUrl(B)}) mossnote-attachment://a/${A}0`;
    expect(attachmentShasIn(t).sort()).toEqual([A, B].sort());
  });

  it('rewriteToRelative replaces known shas and reports unknown ones untouched', () => {
    const text = `![x](${attachmentUrl(A)})\n[y](${attachmentUrl(B)})`;
    const r = rewriteToRelative(text, new Map([[A, `../_attachments/${A}.png`]]));
    expect(r.text).toBe(`![x](../_attachments/${A}.png)\n[y](${attachmentUrl(B)})`);
    expect(r.used).toEqual([A]);
    expect(r.missing).toEqual([B]);
  });

  it('rewriteToRelative percent-encodes characters that would end a destination', () => {
    const r = rewriteToRelative(`[x](${attachmentUrl(A)})`, new Map([[A, '../_attachments/a b(1).png']]));
    expect(r.text).toBe('[x](../_attachments/a%20b%281%29.png)');
  });

  it('rewriteFromRelative asks the resolver only for relative destinations', () => {
    const asked: string[] = [];
    const text = [
      `![a](../_attachments/${A}.png)`,
      `[b](<../_attachments/with space.pdf>)`,
      '[c](https://example.com/x.png)',
      '[d](/abs/x.png)',
      '[e](#frag)',
      '[f](mailto:me@example.com)',
      '[g](../_attachments/unknown.bin)',
    ].join('\n');
    const r = rewriteFromRelative(text, (p) => {
      asked.push(p);
      if (p.endsWith(`${A}.png`)) return A;
      if (p.endsWith('with space.pdf')) return B;
      return undefined;
    });
    expect(asked).toEqual([`../_attachments/${A}.png`, '../_attachments/with space.pdf', '../_attachments/unknown.bin']);
    expect(r.text).toContain(`![a](${attachmentUrl(A)})`);
    expect(r.text).toContain(`[b](${attachmentUrl(B)})`);
    expect(r.text).toContain('[c](https://example.com/x.png)');
    expect(r.text).toContain('[g](../_attachments/unknown.bin)');
    expect(r.replaced.sort()).toEqual([A, B].sort());
  });

  it('rewriteFromRelative ignores a resolver answer that is not a sha256', () => {
    const r = rewriteFromRelative('[a](x.png)', () => 'not-a-hash');
    expect(r.text).toBe('[a](x.png)');
  });

  it('round trip', () => {
    const text = `see ![x](${attachmentUrl(A)}) there`;
    const out = rewriteToRelative(text, new Map([[A, `../_attachments/${A}.png`]])).text;
    const back = rewriteFromRelative(out, (p) => (p.includes(A) ? A : undefined)).text;
    expect(back).toBe(text);
  });
});
