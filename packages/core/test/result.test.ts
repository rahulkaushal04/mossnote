import { describe, expect, it } from 'vitest';
import { err, ok } from '../src/index.ts';

describe('Result helpers', () => {
  it('wraps a value', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
  });

  it('builds an error and keeps the cause only when given', () => {
    expect(err('io', 'disk full')).toEqual({
      ok: false,
      error: { code: 'io', message: 'disk full' },
    });
    const cause = new Error('x');
    const r = err('corrupt', 'bad', cause);
    expect(!r.ok && r.error.cause).toBe(cause);
  });
});
