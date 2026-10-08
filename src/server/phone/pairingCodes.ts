import { timingSafeEqual } from 'node:crypto';
import type { Clock } from '../db/types';
import type { IssuedCode } from './types';

/**
 * One-time pairing codes. The code goes into a QR code that the phone scans, or is typed in by
 * hand. One code is live at a time, it works once, it expires, and too many wrong guesses lock
 * pairing for a minute, so guessing a code over the network is not practical.
 */

/** Crockford's base 32: digits and letters without I, L, O or U, so a code is easy to read out. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 10;
export const CODE_LIFETIME_MS = 10 * 60_000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 60_000;
const LOCKOUT_MS = 60_000;

export type RedeemOutcome = 'ok' | 'invalid' | 'expired' | 'locked';

export interface PairingCodes {
  issue(): IssuedCode;
  /** Check a code typed or scanned on a phone. A correct code is used up by this call. */
  redeem(input: string): RedeemOutcome;
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

export function createPairingCodes(options: PairingCodesOptions): PairingCodes {
  const { clock, randomBytes } = options;
  let live: IssuedCode | null = null;
  let failures: number[] = [];
  let lockedUntil = 0;

  const recordFailure = (now: number) => {
    failures = [...failures.filter((at) => now - at < FAILURE_WINDOW_MS), now];
    if (failures.length >= MAX_FAILURES) {
      lockedUntil = now + LOCKOUT_MS;
      failures = [];
    }
  };

  return {
    issue() {
      const bytes = randomBytes(CODE_LENGTH);
      const code = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
      live = { code, expiresAt: clock.now() + CODE_LIFETIME_MS };
      return live;
    },
    redeem(input) {
      const now = clock.now();
      if (now < lockedUntil) return 'locked';
      if (!live || now >= live.expiresAt) return 'expired';
      if (!sameText(normalizeCode(input), live.code)) {
        recordFailure(now);
        return 'invalid';
      }
      live = null;
      failures = [];
      return 'ok';
    },
  };
}
