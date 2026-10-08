import { describe, expect, it } from 'vitest';
import { holdStorageLock } from './storageLock';

/** A lock manager that hands the lock to the first caller and `null` to the rest. */
function fakeLocks(): LockManager {
  let taken = false;
  return {
    request: (_name: string, _options: unknown, callback: (lock: Lock | null) => unknown) => {
      if (taken) return Promise.resolve(callback(null));
      taken = true;
      return Promise.resolve(callback({ name: 'x', mode: 'exclusive' }));
    },
    query: () => Promise.resolve({}),
  } as unknown as LockManager;
}

describe('holdStorageLock', () => {
  it('gives the lock to the first tab and reports the second as busy', async () => {
    const locks = fakeLocks();

    expect(await holdStorageLock(locks)).toBe('held');
    expect(await holdStorageLock(locks)).toBe('busy');
  });

  it('carries on when the browser has no Web Locks', async () => {
    expect(await holdStorageLock(undefined)).toBe('held');
  });

  it('carries on when asking for the lock fails', async () => {
    const broken = { request: () => Promise.reject(new Error('no')) } as unknown as LockManager;

    expect(await holdStorageLock(broken)).toBe('held');
  });
});
