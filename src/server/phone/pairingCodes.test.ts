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

describe('wrong guesses are counted for each device that makes them', () => {
  const wrong = (codes: ReturnType<typeof setup>['codes'], peer: string, times: number) => {
    for (let guess = 0; guess < times; guess++) codes.redeem('WRONGWRONG', peer);
  };

  it('does not let one device lock the others out', () => {
    const { codes } = setup();
    const { code } = codes.issue();
    wrong(codes, '192.168.1.99', 10);

    expect(codes.redeem(code, '192.168.1.99')).toBe('locked');
    expect(codes.redeem(code, '192.168.1.50')).toBe('ok');
  });

  it('locks a device that guesses wrong ten times for a minute, even for the right code', () => {
    const { clock, codes } = setup();
    const { code } = codes.issue();
    wrong(codes, '192.168.1.99', 10);

    expect(codes.redeem(code, '192.168.1.99')).toBe('locked');

    clock.advance(60_000);
    expect(codes.redeem(code, '192.168.1.99')).toBe('ok');
  });

  it('counts each device on its own: nine wrong guesses each lock none of them', () => {
    const { codes } = setup();
    const { code } = codes.issue();
    for (const peer of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) wrong(codes, peer, 9);

    expect(codes.redeem('WRONGWRONG', '10.0.0.1')).toBe('invalid');
    expect(codes.redeem(code, '10.0.0.4')).toBe('ok');
  });

  it('forgets a device’s wrong guesses once it pairs', () => {
    const { codes } = setup();
    codes.issue();
    wrong(codes, '10.0.0.1', 9);
    expect(codes.redeem(codes.issue().code, '10.0.0.1')).toBe('ok');

    codes.issue();
    wrong(codes, '10.0.0.1', 9);
    expect(codes.redeem('WRONGWRONG', '10.0.0.1')).toBe('invalid');
  });

  it('still bounds guessing by many devices: a hundred wrong guesses in all lock everyone', () => {
    const { clock, codes } = setup();
    const { code } = codes.issue();
    for (let device = 0; device < 10; device++) wrong(codes, `10.0.1.${device}`, 10);

    expect(codes.redeem(code, '10.0.2.1')).toBe('locked');

    clock.advance(60_000);
    expect(codes.redeem(code, '10.0.2.1')).toBe('ok');
  });

  it('counts guesses from an unknown address together', () => {
    const { codes } = setup();
    const { code } = codes.issue();
    for (let guess = 0; guess < 10; guess++) codes.redeem('WRONGWRONG');

    expect(codes.redeem(code)).toBe('locked');
    expect(codes.redeem(code, '192.168.1.50')).toBe('ok');
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
