import { randomBytes as nodeRandomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Clock } from '../db/types';
import { createDeviceRegistry } from './deviceRegistry';
import { isOwnAddress, lanAddresses, lanHostValues, type Interfaces } from './network';
import { createPairingCodes, formatCode } from './pairingCodes';
import type { PhoneAccess } from './types';

/**
 * Phone access for the Node server: the paired-devices file, one-time codes, the network
 * addresses a phone can use, and the saved on/off choice. The app only sees {@link PhoneAccess}.
 */

export const PREFERENCE_FILE = 'phone-access.json';
export const DEVICES_FILE = 'phone-devices.json';

const preferenceSchema = z.object({ enabled: z.boolean() });

/** The saved on/off choice, or undefined when none was saved (or the file is unreadable). */
export function readPhonePreference(dataDir: string): boolean | undefined {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dataDir, PREFERENCE_FILE), 'utf8'));
    return preferenceSchema.parse(raw).enabled;
  } catch {
    return undefined;
  }
}

function writePhonePreference(dataDir: string, enabled: boolean): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, PREFERENCE_FILE), JSON.stringify({ enabled }), {
    mode: 0o600,
  });
}

export interface PhoneAccessOptions {
  /** Where the paired devices and the on/off choice are kept. Omit to keep nothing on disk. */
  dataDir?: string;
  port: number;
  clock: Clock;
  /** Whether phone access starts on. */
  enabled: boolean;
  randomBytes?: (length: number) => Uint8Array;
  /** The computer's network interfaces and name; tests pass fixed ones. */
  network?: { interfaces: () => Interfaces; hostname: () => string };
}

export function createPhoneAccess(options: PhoneAccessOptions): PhoneAccess {
  const { dataDir, port, clock } = options;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const interfaces = options.network?.interfaces ?? os.networkInterfaces;
  const hostname = options.network?.hostname ?? os.hostname;
  const devices = createDeviceRegistry({
    ...(dataDir ? { file: path.join(dataDir, DEVICES_FILE) } : {}),
    clock,
    randomBytes,
  });
  const codes = createPairingCodes({ clock, randomBytes });
  const listeners = new Set<(enabled: boolean) => void>();
  let enabled = options.enabled;

  return {
    isEnabled: () => enabled,
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      if (dataDir) writePhonePreference(dataDir, next);
      for (const listener of listeners) listener(next);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    allowedHosts: () => (enabled ? lanHostValues(port, interfaces(), hostname()) : new Set()),
    addresses: () =>
      enabled ? lanAddresses(interfaces()).map((address) => `http://${address}:${port}`) : [],
    isLocalPeer: (address) => address !== undefined && isOwnAddress(address, interfaces()),
    authenticate: (token) => devices.authenticate(token),
    issueCode() {
      const issued = codes.issue();
      return { code: formatCode(issued.code), expiresAt: issued.expiresAt };
    },
    redeemCode(code, userAgent) {
      const outcome = codes.redeem(code);
      if (outcome !== 'ok') return { ok: false, reason: outcome };
      return { ok: true, ...devices.add(userAgent) };
    },
    listDevices: () => devices.list(),
    revokeDevice: (id) => devices.revoke(id),
    revokeAllDevices: () => devices.revokeAll(),
  };
}
