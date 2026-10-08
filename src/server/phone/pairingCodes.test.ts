import { describe, expect, it } from 'vitest';
import { fakeClock } from '../testing/helpers';
import {
  CODE_LENGTH,
  CODE_LIFETIME_MS,
  createPairingCodes,
  formatCode,
  normalizeCode,
} from './pairingCodes';

/** A source of bytes that counts up, so each code is different and known. */
function countingBytes() {
  let next = 0;
  return (length: number) => Uint8Array.from({ length }, () => next++);
}

function setup() {
  const clock = fakeClock();
  const codes = createPairingCodes({ clock, randomBytes: countingBytes() });
  return { clock, codes };
}

describe('pairing codes', () => {
  it('makes a code of the right length from the readable alphabet', () => {
    const { codes } = setup();

    const { code } = codes.issue();

    expect(code).toHaveLength(CODE_LENGTH);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it('accepts the code once and then refuses it', () => {
    const { codes } = setup();
    const { code } = codes.issue();

    expect(codes.redeem(code)).toBe('ok');
    expect(codes.redeem(code)).toBe('expired');
  });

  it('accepts a code typed in lower case, with a dash and look-alike letters', () => {
    const { codes } = setup();
    const { code } = codes.issue();
    const typed = formatCode(code).toLowerCase().replaceAll('0', 'o').replaceAll('1', 'l');

    expect(codes.redeem(typed)).toBe('ok');
  });

  it('refuses a wrong code and keeps the right one usable', () => {
    const { codes } = setup();
    const { code } = codes.issue();

    expect(codes.redeem('WRONGWRONG')).toBe('invalid');
    expect(codes.redeem(code)).toBe('ok');
  });

  it('refuses a code after ten minutes', () => {
    const { clock, codes } = setup();
    const { code } = codes.issue();

    clock.advance(CODE_LIFETIME_MS);

    expect(codes.redeem(code)).toBe('expired');
  });

  it('refuses everything when no code was made', () => {
    const { codes } = setup();

    expect(codes.redeem('ABCDEFGHJK')).toBe('expired');
  });

  it('stops an earlier code from working once a new one is made', () => {
    const { codes } = setup();
    const first = codes.issue();
    const second = codes.issue();

    expect(codes.redeem(first.code)).toBe('invalid');
    expect(codes.redeem(second.code)).toBe('ok');
  });

  it('locks pairing for a minute after ten wrong guesses, even for the right code', () => {
    const { clock, codes } = setup();
    const { code } = codes.issue();
    for (let guess = 0; guess < 10; guess++) codes.redeem('WRONGWRONG');

    expect(codes.redeem(code)).toBe('locked');

    clock.advance(60_000);
    expect(codes.redeem(code)).toBe('ok');
  });

  it('does not count guesses that are more than a minute apart', () => {
    const { clock, codes } = setup();
    const { code } = codes.issue();
    for (let guess = 0; guess < 9; guess++) {
      codes.redeem('WRONGWRONG');
      clock.advance(10_000);
    }
    clock.advance(60_000);
    codes.redeem('WRONGWRONG');

    expect(codes.redeem(code)).toBe('ok');
  });
});

describe('code text', () => {
  it('normalises case, spaces, dashes and look-alike letters', () => {
    expect(normalizeCode(' ab-c0 oIl ')).toBe('ABC0011');
  });

  it('shows a code in two groups of five', () => {
    expect(formatCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
  });
});
