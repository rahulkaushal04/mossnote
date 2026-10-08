import { describe, expect, it } from 'vitest';
import { describeDevice } from './describeDevice';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET_FIREFOX =
  'Mozilla/5.0 (Android 14; Tablet; rv:127.0) Gecko/127.0 Firefox/127.0';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

describe('describeDevice', () => {
  it('names phones and tablets with their browser', () => {
    expect(describeDevice(IPHONE_SAFARI)).toBe('iPhone (Safari)');
    expect(describeDevice(IPAD_SAFARI)).toBe('iPad (Safari)');
    expect(describeDevice(ANDROID_CHROME)).toBe('Android phone (Chrome)');
    expect(describeDevice(ANDROID_TABLET_FIREFOX)).toBe('Android tablet (Firefox)');
  });

  it('names computers', () => {
    expect(describeDevice(MAC_SAFARI)).toBe('Mac (Safari)');
  });

  it('falls back when the user agent is missing or unknown', () => {
    expect(describeDevice(undefined)).toBe('Unknown device');
    expect(describeDevice('curl/8.0')).toBe('Unknown device');
  });
});
