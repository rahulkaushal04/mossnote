import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PortError } from '../../src/portability/errors.ts';
import { reservedRootNames, sanitizeComponent, uniqueName, within } from '../../src/portability/names.ts';

const cp = (n: number): string => String.fromCodePoint(n);
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

function check(name: string): void {
  expect(name.length).toBeGreaterThan(0);
  expect(name).not.toMatch(/[\\/]/);
  expect(name).not.toBe('.');
  expect(name).not.toBe('..');
  expect(name).not.toMatch(/^\./);
  expect(name).not.toMatch(/[ .]$/);
  expect(RESERVED.test(name)).toBe(false);
  expect(bytes(name)).toBeLessThanOrEqual(255);
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    expect(c < 0x20 || (c >= 0x7f && c <= 0x9f)).toBe(false);
    expect((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x2028 || c === 0x2029).toBe(false);
  }
}

describe('filename sanitizer (PT-2)', () => {
  const hostile = [
    '..',
    '.',
    '../../etc/passwd',
    '/abs/path',
    'a/b',
    'a\\b',
    'CON',
    'con.txt',
    'NUL.md',
    'com1',
    'LPT9.log',
    'name\0with nul',
    `evil${cp(0x202e)}gnp.exe`,
    `iso${cp(0x2066)}late${cp(0x2069)}`,
    'tab\tand\nnewline',
    'trailing dot.',
    '   spaced   ',
    '.hidden',
    '',
    '   ',
    '...',
    '😀'.repeat(300),
    'é'.repeat(300),
    `${'a'.repeat(300)}.md`,
    'q?:*"<>|',
  ];
  it('produces one safe component for every hostile name', () => {
    for (const h of hostile) check(sanitizeComponent(h));
  });
  it('prefixes reserved names and removes bidi controls', () => {
    expect(sanitizeComponent('CON')).toBe('_CON');
    expect(sanitizeComponent('nul.txt')).toBe('_nul.txt');
    expect(sanitizeComponent('..')).toBe('Untitled');
    expect(sanitizeComponent(`a${cp(0x202e)}b`)).toBe('ab');
    expect(sanitizeComponent('a/b')).toBe('a-b');
  });
  it('normalizes to NFC and caps at 100 bytes on a code point boundary', () => {
    expect(sanitizeComponent('é')).toBe('é');
    const long = sanitizeComponent('😀'.repeat(300));
    expect(bytes(long)).toBeLessThanOrEqual(100);
    expect(long).toBe('😀'.repeat(25));
  });
  it('resolves collisions case-insensitively, per directory, files and folders sharing the set', () => {
    const used = reservedRootNames();
    expect(uniqueName('Foo', '.md', used)).toBe('Foo.md');
    expect(uniqueName('foo', '.md', used)).toBe('foo (2).md');
    expect(uniqueName('FOO', '.md', used)).toBe('FOO (3).md');
    expect(uniqueName('_attachments', '', used)).toBe('_attachments (2)');
    expect(uniqueName('mossnote-export', '.json', used)).toBe('mossnote-export (2).json'); // reserved at the root
    expect(uniqueName('Same', '', used)).toBe('Same');
    expect(uniqueName('same', '.md', used)).toBe('same.md'); // different final name, different key
  });
  it('fuzz: 10k random Unicode titles x3 per dir stay safe and unique, and a real write stays inside the root', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pool = [0x2f, 0x5c, 0x2e, 0x00, 0x1f, 0x7f, 0x85, 0x202e, 0x2066, 0x2028, 0x41, 0x61, 0x20, 0xe9, 0x301, 0x1f600, 0x3042, 0x3a, 0x2a, 0x3f];
    const root = mkdtempSync(join(tmpdir(), 'mossnote-names-'));
    try {
      const used = new Set<string>();
      for (let i = 0; i < 10_000; i++) {
        let s = '';
        const len = Math.floor(rnd() * 40);
        for (let j = 0; j < len; j++) s += rnd() < 0.5 ? cp(pool[Math.floor(rnd() * pool.length)]!) : String.fromCharCode(32 + Math.floor(rnd() * 400));
        for (let k = 0; k < 3; k++) {
          const name = uniqueName(s, '.md', used);
          const base = name.slice(0, -3);
          check(base.replace(/ \(\d+\)$/, '') || 'x');
          expect(bytes(name)).toBeLessThanOrEqual(255);
          if (i < 300) writeFileSync(within(root, name), 'x');
        }
      }
      expect(used.size).toBe(30_000);
      expect(readdirSync(root).length).toBe(900);
      for (const n of readdirSync(root)) expect(n).not.toMatch(/[\\/]/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('within() refuses anything that leaves the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'mossnote-within-'));
    try {
      mkdirSync(join(root, 'a'));
      expect(within(root, 'a/b.md')).toBe(join(root, 'a', 'b.md'));
      for (const bad of ['../x', 'a/../../x', '/etc/passwd', '..', '.']) expect(() => within(root, bad)).toThrow(PortError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
