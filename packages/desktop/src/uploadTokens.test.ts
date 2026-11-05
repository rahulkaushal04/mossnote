import { describe, expect, it } from 'vitest';
import { createUploadTokens, type TokenFs } from './uploadTokens.ts';

function setup(opts: { max?: number; files?: Record<string, 'file' | 'dir' | 'unreadable'> } = {}) {
  let t = 1000;
  let n = 0;
  const files = opts.files ?? {};
  const links: Record<string, string> = { '/link/a.png': '/real/a.png' };
  const fs: TokenFs = {
    realpath: async (p) => {
      const r = links[p] ?? p;
      if (!(r in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return r;
    },
    stat: async (p) => ({ isFile: () => files[p] !== 'dir' }),
    access: async (p) => {
      if (files[p] === 'unreadable') throw new Error('EACCES');
    },
  };
  const tokens = createUploadTokens({ fs, now: () => t, newToken: () => `tok${++n}`, max: opts.max });
  return { tokens, advance: (ms: number) => (t += ms) };
}
const files = { '/a.png': 'file', '/real/a.png': 'file', '/d': 'dir', '/nope': 'unreadable' } as const;

describe('upload tokens (AT-1)', () => {
  it('issues a single-use token that resolves to the real path', async () => {
    const s = setup({ files });
    const tok = await s.tokens.register('/link/a.png');
    expect(tok).toBe('tok1');
    expect(s.tokens.resolve('tok1')).toBe('/real/a.png'); // symlink resolved
    expect(s.tokens.resolve('tok1')).toBeUndefined();
  });
  it('expires after 60 s', async () => {
    const s = setup({ files });
    await s.tokens.register('/a.png');
    s.advance(60_001);
    expect(s.tokens.resolve('tok1')).toBeUndefined();
    await s.tokens.register('/a.png');
    s.advance(59_000);
    expect(s.tokens.resolve('tok2')).toBe('/a.png');
  });
  it('refuses directories, unreadable, missing, relative, NUL, oversize and non-string paths', async () => {
    const s = setup({ files });
    for (const p of ['/d', '/nope', '/missing', 'rel/a.png', '/a\0.png', '/' + 'x'.repeat(5000), 5, null, undefined])
      expect(await s.tokens.register(p), String(p)).toBeUndefined();
    expect(s.tokens.size).toBe(0);
  });
  it('is bounded, and expired tokens make room', async () => {
    const s = setup({ files, max: 2 });
    expect(await s.tokens.register('/a.png')).toBeDefined();
    expect(await s.tokens.register('/a.png')).toBeDefined();
    expect(await s.tokens.register('/a.png')).toBeUndefined();
    s.advance(61_000);
    expect(await s.tokens.register('/a.png')).toBeDefined();
    expect(s.tokens.size).toBe(1);
  });
  it('an unknown token resolves to nothing', () => {
    expect(setup().tokens.resolve('x')).toBeUndefined();
  });
});
