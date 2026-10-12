import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClock, makeTempDir, removeDir } from '../testing/helpers';
import { wifiAt } from '../testing/network';
import { createPhoneAccess, PREFERENCE_FILE, readPhonePreference } from '.';

let dir: string;
beforeEach(() => {
  dir = makeTempDir('moss-phone-');
});
afterEach(() => {
  removeDir(dir);
});

const NETWORK = { interfaces: () => wifiAt('192.168.1.20'), hostname: () => 'laptop' };

const make = (enabled: boolean) =>
  createPhoneAccess({ dataDir: dir, port: 4317, clock: fakeClock(), enabled, network: NETWORK });

describe('phone access', () => {
  it('offers no addresses and accepts no phone hosts while off', () => {
    const phone = make(false);

    expect(phone.addresses()).toEqual([]);
    expect(phone.allowedHosts().size).toBe(0);
  });

  it('offers the computer’s addresses once on', () => {
    const phone = make(true);

    expect(phone.addresses()).toEqual(['http://192.168.1.20:4317']);
    expect(phone.allowedHosts()).toEqual(new Set(['192.168.1.20:4317', 'laptop.local:4317']));
  });

  it('remembers the choice and tells listeners, once per change', () => {
    const phone = make(false);
    const heard = vi.fn();
    phone.onChange(heard);

    phone.setEnabled(true);
    phone.setEnabled(true);

    expect(heard).toHaveBeenCalledExactlyOnceWith(true);
    expect(readPhonePreference(dir)).toBe(true);
  });

  it('stops telling a listener that unsubscribed', () => {
    const phone = make(false);
    const heard = vi.fn();
    phone.onChange(heard)();

    phone.setEnabled(true);

    expect(heard).not.toHaveBeenCalled();
  });

  it('counts only the computer itself as local', () => {
    const phone = make(true);

    expect(phone.isLocalPeer('127.0.0.1')).toBe(true);
    expect(phone.isLocalPeer('192.168.1.20')).toBe(true);
    expect(phone.isLocalPeer('192.168.1.50')).toBe(false);
    expect(phone.isLocalPeer(undefined)).toBe(false);
  });

  it('pairs a device with a code and keeps the code to one use', () => {
    const phone = make(true);
    const { code } = phone.issueCode();

    const first = phone.redeemCode(code, 'Mozilla/5.0 (iPad) Safari');
    const second = phone.redeemCode(code, undefined);

    expect(first.ok && phone.authenticate(first.token)?.name).toBe('iPad (Safari)');
    expect(second).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('when the choice cannot be saved', () => {
  /** A data folder that cannot be written: a file is where the folder should be. */
  const unwritable = (enabled: boolean) => {
    const inTheWay = path.join(dir, 'in-the-way');
    fs.writeFileSync(inTheWay, 'a file, not a folder');
    return createPhoneAccess({
      dataDir: inTheWay,
      port: 4317,
      clock: fakeClock(),
      enabled,
      network: NETWORK,
    });
  };

  it('stays off, tells no one and accepts no phone, when turning on fails', () => {
    const phone = unwritable(false);
    const heard = vi.fn();
    phone.onChange(heard);

    expect(() => {
      phone.setEnabled(true);
    }).toThrow();

    expect(phone.isEnabled()).toBe(false);
    expect(heard).not.toHaveBeenCalled();
    expect(phone.addresses()).toEqual([]);
    expect(phone.allowedHosts().size).toBe(0);
  });

  it('stays on, and tells no one, when turning off fails', () => {
    const phone = unwritable(true);
    const heard = vi.fn();
    phone.onChange(heard);

    expect(() => {
      phone.setEnabled(false);
    }).toThrow();

    expect(phone.isEnabled()).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    expect(phone.addresses()).toEqual(['http://192.168.1.20:4317']);
  });

  it('can be tried again, and works once the folder can be written', () => {
    const phone = make(false);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, 'in the way');
    expect(() => {
      phone.setEnabled(true);
    }).toThrow();
    expect(phone.isEnabled()).toBe(false);

    fs.rmSync(dir, { force: true });
    fs.mkdirSync(dir);
    phone.setEnabled(true);

    expect(phone.isEnabled()).toBe(true);
    expect(readPhonePreference(dir)).toBe(true);
  });
});

describe('the saved choice', () => {
  it('is undefined when nothing was saved or the file is unreadable', () => {
    expect(readPhonePreference(dir)).toBeUndefined();
    fs.writeFileSync(path.join(dir, PREFERENCE_FILE), 'oops');
    expect(readPhonePreference(dir)).toBeUndefined();
  });
});
