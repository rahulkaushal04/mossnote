import { timingSafeEqual } from 'node:crypto';
import type { Clock } from '../db/types';
import type { IssuedCode } from './types';

/**
 * One-time pairing codes. The code goes into a QR code that the phone scans, or is typed in by
 * hand. One code is live at a time, it works once, it expires, and too many wrong guesses lock
 * pairing for a minute, so guessing a code over the network is not practical.
 *
 * Guesses are counted for each device (by the address its connection comes from), so one device
 * that keeps guessing is locked out without stopping a phone that is pairing at the same time. A
 * larger limit over all devices together still bounds guessing from many addresses.
 */

/** Crockford's base 32: digits and letters without I, L, O or U, so a code is easy to read out. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 10;
export const CODE_LIFETIME_MS = 10 * 60_000;
/** Wrong guesses from one device within the window before that device is locked out. */
const MAX_FAILURES = 10;
/** Wrong guesses from all devices together within the window before everyone is locked out. */
const MAX_FAILURES_ALL = 100;
const FAILURE_WINDOW_MS = 60_000;
const LOCKOUT_MS = 60_000;
/** The key for a connection whose address is not known: all of them are counted as one device. */
const UNKNOWN_PEER = '?';

export type RedeemOutcome = 'ok' | 'invalid' | 'expired' | 'locked';

export interface PairingCodes {
  issue(): IssuedCode;
  /**
   * Check a code typed or scanned on a phone, coming from the device at `peer` (its connection's
   * address). A correct code is used up by this call.
   */
  redeem(input: string, peer?: string): RedeemOutcome;
}

export interface PairingCodesOptions {
  clock: Clock;
  /** Source of random bytes; tests pass a fixed one. */
  randomBytes: (length: number) => Uint8Array;
}

/** Upper case, without spaces or dashes, and with the look-alike letters read as digits. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replaceAll('O', '0')
    .replaceAll('I', '1')
    .replaceAll('L', '1');
}

/** `ABCDE-FGHJK`: easier to read off a screen than ten characters in a row. */
export function formatCode(code: string): string {
  return `${code.slice(0, CODE_LENGTH / 2)}-${code.slice(CODE_LENGTH / 2)}`;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Wrong guesses within the window, and when guessing stops being allowed. */
interface Tally {
  failures: number[];
  lockedUntil: number;
}

export function createPairingCodes(options: PairingCodesOptions): PairingCodes {
  const { clock, randomBytes } = options;
  let live: IssuedCode | null = null;
  const everyone: Tally = { failures: [], lockedUntil: 0 };
  const devices = new Map<string, Tally>();

  /** Add a failure to a tally and lock it when it reaches `max`. */
  const record = (tally: Tally, now: number, max: number) => {
    tally.failures = [...tally.failures.filter((at) => now - at < FAILURE_WINDOW_MS), now];
    if (tally.failures.length >= max) {
      tally.lockedUntil = now + LOCKOUT_MS;
      tally.failures = [];
    }
  };

  /** Forget devices with nothing left to count. Failures are not recorded while everyone is
   * locked, so no more than the global limit of devices can be waiting here at once. */
  const forgetQuietDevices = (now: number) => {
    for (const [peer, tally] of devices) {
      const quiet =
        now >= tally.lockedUntil && tally.failures.every((at) => now - at >= FAILURE_WINDOW_MS);
      if (quiet) devices.delete(peer);
    }
  };

  return {
    issue() {
      const bytes = randomBytes(CODE_LENGTH);
      const code = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
      live = { code, expiresAt: clock.now() + CODE_LIFETIME_MS };
      return live;
    },
    redeem(input, peer = UNKNOWN_PEER) {
      const now = clock.now();
      forgetQuietDevices(now);
      const device = devices.get(peer);
      if (now < everyone.lockedUntil || (device && now < device.lockedUntil)) return 'locked';
      if (!live || now >= live.expiresAt) return 'expired';
      if (!sameText(normalizeCode(input), live.code)) {
        const own = device ?? { failures: [], lockedUntil: 0 };
        devices.set(peer, own);
        record(own, now, MAX_FAILURES);
        record(everyone, now, MAX_FAILURES_ALL);
        return 'invalid';
      }
      live = null;
      devices.delete(peer);
      return 'ok';
    },
  };
}
