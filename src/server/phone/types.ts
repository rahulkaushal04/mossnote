import type { PairedDevice } from '@shared/types';

/**
 * Phone access: letting a phone or tablet on the same network use the journal that lives on this
 * computer. This is the contract the app and its routes see; the implementation (network
 * discovery, the paired-devices file, one-time codes) is in `index.ts` and is Node only.
 */

export interface IssuedCode {
  /** Ten characters from an alphabet without look-alikes; see `pairingCodes.ts`. */
  code: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type RedeemResult =
  | { ok: true; token: string; device: PairedDevice }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' };

export interface PhoneAccess {
  /** True while the server listens on the local network and asks for a pairing. */
  isEnabled(): boolean;
  /** Turn phone access on or off, remember the choice, and tell the listeners. */
  setEnabled(enabled: boolean): void;
  /** Called after every change made by {@link setEnabled}. Returns the way to stop listening. */
  onChange(listener: (enabled: boolean) => void): () => void;
  /** `Host` header values a phone may use, such as `192.168.1.20:4317`. Empty while disabled. */
  allowedHosts(): ReadonlySet<string>;
  /** Base URLs a phone can open, such as `http://192.168.1.20:4317`. Empty while disabled. */
  addresses(): string[];
  /** True when the other end of the connection is this computer itself. */
  isLocalPeer(address: string | undefined): boolean;
  /** The paired device a session token belongs to, or null. */
  authenticate(token: string): PairedDevice | null;
  /** Make a new one-time code. Any earlier code stops working. */
  issueCode(): IssuedCode;
  /** Exchange a code for a session token. */
  redeemCode(code: string, userAgent: string | undefined): RedeemResult;
  listDevices(): PairedDevice[];
  revokeDevice(id: string): boolean;
  /** Returns how many devices were removed. */
  revokeAllDevices(): number;
}
