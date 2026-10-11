import { describe, expect, it, vi } from 'vitest';
import { createPhoneAccess } from '.';
import { fakeClock } from '../testing/helpers';
import { silentLogger } from '../logger';
import type { Listener } from '../listener';
import { followPhoneAccess } from './followAccess';

const makePhone = (enabled: boolean) =>
  createPhoneAccess({ port: 4317, clock: fakeClock(), enabled });

const fakeListener = (rebind: Listener['rebind']): Listener => ({
  host: '127.0.0.1',
  rebind,
  close: () => Promise.resolve(),
});

const hostFor = (on: boolean) => (on ? '0.0.0.0' : '127.0.0.1');

describe('followPhoneAccess', () => {
  it('moves the socket and marks the network closed after phone access is turned off', async () => {
    vi.useFakeTimers();
    const phone = makePhone(true);
    const rebind = vi.fn().mockResolvedValue(undefined);
    followPhoneAccess({
      phone,
      listener: fakeListener(rebind),
      hostFor,
      delayMs: 200,
      logger: silentLogger,
    });

    phone.setEnabled(false);
    await vi.advanceTimersByTimeAsync(200);

    expect(rebind).toHaveBeenCalledWith('127.0.0.1');
    expect(phone.isOpenToNetwork()).toBe(false);
    vi.useRealTimers();
  });

  it('keeps the network marked open when the socket could not be moved', async () => {
    vi.useFakeTimers();
    const phone = makePhone(true);
    const rebind = vi.fn().mockRejectedValue(new Error('port taken'));
    followPhoneAccess({
      phone,
      listener: fakeListener(rebind),
      hostFor,
      delayMs: 200,
      logger: silentLogger,
    });

    phone.setEnabled(false);
    await vi.advanceTimersByTimeAsync(200);

    expect(phone.isOpenToNetwork()).toBe(true);
    vi.useRealTimers();
  });

  it('marks the network open once the socket listens on every interface', async () => {
    vi.useFakeTimers();
    const phone = makePhone(false);
    const rebind = vi.fn().mockResolvedValue(undefined);
    followPhoneAccess({
      phone,
      listener: fakeListener(rebind),
      hostFor,
      delayMs: 200,
      logger: silentLogger,
    });

    phone.setEnabled(true);
    await vi.advanceTimersByTimeAsync(200);

    expect(phone.isOpenToNetwork()).toBe(true);
    vi.useRealTimers();
  });
});
