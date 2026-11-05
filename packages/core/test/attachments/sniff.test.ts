import { describe, expect, it } from 'vitest';
import { EXECUTABLE_EXTENSIONS, sniff } from '../../src/attachments/sniff.ts';
import { makePdf, PNG } from './util.ts';

const b = (...v: number[]) => Uint8Array.from(v);
const s = (t: string) => Buffer.from(t);

describe('AT-4 MIME sniffing (bytes win, the claimed name never downgrades)', () => {
  it('a PNG named .txt is an image; a PDF named .png is a pdf', () => {
    expect(sniff(PNG, 'notes.txt')).toEqual({ mime: 'image/png', kind: 'image' });
    expect(sniff(makePdf('x'), 'photo.png')).toEqual({ mime: 'application/pdf', kind: 'pdf' });
  });

  it('a Mach-O, ELF, PE or #! script is an executable whatever its name', () => {
    for (const head of [
      b(0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0),
      b(0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 0),
      b(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2),
      b(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0),
      s('MZ\x90\x00\x03'),
      s('#!/bin/sh\necho hi\n'),
    ])
      for (const name of ['pic.jpg', 'a.txt', 'doc.pdf'])
        expect(sniff(head, name).kind, name).toBe('executable');
  });

  it('an extension can only UPGRADE to executable', () => {
    expect(sniff(s('echo hi'), 'run.sh').kind).toBe('executable');
    expect(sniff(s('plain'), 'x.webloc').kind).toBe('executable');
    expect(sniff(PNG, 'looks.app').kind).toBe('executable');
    expect(sniff(s('plain'), 'x.txt').kind).toBe('text');
    expect(EXECUTABLE_EXTENSIONS.has('.terminal')).toBe(true);
    expect(EXECUTABLE_EXTENSIONS.has('.fileloc')).toBe(true);
    expect(EXECUTABLE_EXTENSIONS.has('.command')).toBe(true);
  });

  it('HTML named .png is html; SVG is svg (also behind an xml prolog and a doctype)', () => {
    expect(sniff(s('<!DOCTYPE html><html><body>x</body></html>'), 'a.png').kind).toBe('html');
    expect(sniff(s('  <script>alert(1)</script>'), 'a.png').kind).toBe('html');
    expect(sniff(s('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.txt').kind).toBe('svg');
    expect(
      sniff(s('<?xml version="1.0"?>\n<!-- c -->\n<!DOCTYPE svg PUBLIC "x" "y">\n<svg width="1"/>'), 'a.png')
        .kind,
    ).toBe('svg');
    expect(sniff(s('<svgish>not svg</svgish>'), 'a.svg').kind).toBe('text');
  });

  it('audio and video containers', () => {
    expect(sniff(s('ID3\x03\x00'), 'a.bin2').kind).toBe('audio');
    expect(sniff(s('OggS\x00'), 'a.x').kind).toBe('audio');
    expect(sniff(s('fLaC'), 'a.x').kind).toBe('audio');
    expect(sniff(Buffer.concat([s('RIFF\0\0\0\0WAVE')]), 'a.x').kind).toBe('audio');
    expect(sniff(Buffer.concat([b(0, 0, 0, 0x18), s('ftypisom')]), 'a.x')).toEqual({
      mime: 'video/mp4',
      kind: 'video',
    });
    expect(sniff(Buffer.concat([b(0, 0, 0, 0x14), s('ftypM4A ')]), 'a.x').kind).toBe('audio');
    expect(sniff(b(0x1a, 0x45, 0xdf, 0xa3, 0), 'a.x')).toEqual({ mime: 'video/webm', kind: 'video' });
  });

  it('other raster formats, zip, utf-8 text, binary junk, empty', () => {
    expect(sniff(Buffer.concat([s('RIFF\0\0\0\0WEBPVP8 ')]), 'a.x').kind).toBe('image');
    expect(sniff(s('GIF89a....'), 'a.x').kind).toBe('image');
    expect(sniff(b(0xff, 0xd8, 0xff, 0xe0), 'a.x').kind).toBe('image');
    expect(sniff(s('PK\x03\x04rest'), 'a.docx')).toEqual({ mime: 'application/zip', kind: 'other' });
    expect(sniff(s('café 日本'), 'n.md')).toEqual({ mime: 'text/plain', kind: 'text' });
    expect(sniff(b(0, 1, 2, 3, 0xff, 0xfe, 0xfd), 'x.dat').kind).toBe('other');
    expect(sniff(s('text with a \u0000 nul'), 'x.txt').kind).toBe('other');
    expect(sniff(new Uint8Array(0), 'empty.txt').kind).toBe('text');
  });

  it('a multi-byte character cut by the 4 KiB window does not make text look binary', () => {
    const head = Buffer.concat([Buffer.from('a'.repeat(4095)), Buffer.from('é').subarray(0, 1)]);
    expect(sniff(head, 'x.txt').kind).toBe('text');
  });

  it('"BM" text is not a bitmap', () => {
    expect(sniff(s('BM is the abbreviation of something'), 'x.txt').kind).toBe('text');
  });
});
