import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorBody } from '@shared/errors';
import type { PairingCode, PhoneStatus } from '@shared/types';
import { createPhoneAccess } from '../phone';
import type { PhoneAccess } from '../phone/types';
import { fakeClock } from '../testing/helpers';
import { wifiAt } from '../testing/network';
import {
  LAN_ADDRESS,
  LAN_HOST,
  makeTestApp,
  PHONE_ADDRESS,
  TEST_HOST,
  TEST_PORT,
  type TestApp,
} from '../testing/app';

const INTERFACES = () => wifiAt(LAN_ADDRESS);

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 Safari/604.1';

let t: TestApp;
let phone: PhoneAccess;

async function start(enabled: boolean) {
  phone = createPhoneAccess({
    port: TEST_PORT,
    clock: fakeClock(),
    enabled,
    network: { interfaces: INTERFACES, hostname: () => 'laptop' },
  });
  t = await makeTestApp({ phone });
}

afterEach(() => {
  t.close();
});

/** A request from the computer itself, reaching the server over loopback. */
const computer = (method: string, path: string, body?: unknown) =>
  t.callFrom('127.0.0.1', method, path, body, { host: TEST_HOST });

const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
};

/** Pair a phone and return the cookie it would send from then on. */
async function pairPhone(): Promise<string> {
  const { code } = phone.issueCode();
  const res = await t.callFrom(PHONE_ADDRESS, 'GET', `/pair?code=${code}`, undefined, {
    'user-agent': IPHONE,
  });
  expect(res.status).toBe(303);
  const cookie = res.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

describe('while phone access is off', () => {
  beforeEach(() => start(false));

  it('reports itself as off to the computer', async () => {
    const status = await json<PhoneStatus>(await t.call('GET', '/api/phone'));

    expect(status).toMatchObject({ enabled: false, addresses: [], devices: [] });
  });

  it('refuses a request that names a network address as its host', async () => {
    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/api/health');

    expect(res.status).toBe(403);
  });

  it('has no pairing page', async () => {
    expect((await t.call('GET', '/pair')).status).toBe(404);
  });

  it('will not make a pairing code', async () => {
    const res = await t.call('POST', '/api/phone/code');

    const body = await json<ApiErrorBody>(res, 409);
    expect(body.error.details).toEqual({ reason: 'phone_access_off' });
  });

  it('turns on when the computer asks', async () => {
    const status = await json<PhoneStatus>(await t.call('PUT', '/api/phone', { enabled: true }));

    expect(status).toMatchObject({ enabled: true, addresses: [`http://${LAN_HOST}`] });
    expect(phone.isEnabled()).toBe(true);
  });

  it('rejects a body that is not exactly { enabled }', async () => {
    expect((await t.call('PUT', '/api/phone', { enabled: 'yes' })).status).toBe(400);
    expect((await t.call('PUT', '/api/phone', { enabled: true, extra: 1 })).status).toBe(400);
  });
});

describe('while phone access is on', () => {
  beforeEach(() => start(true));

  it('lets the computer use the app without pairing', async () => {
    expect((await computer('GET', '/api/health')).status).toBe(200);
    expect(
      (await t.callFrom('127.0.0.1', 'GET', '/api/health', undefined, { host: LAN_HOST })).status,
    ).toBe(200);
    expect((await t.callFrom(LAN_ADDRESS, 'GET', '/api/health')).status).toBe(200);
  });

  it('turns a page request from an unpaired phone into the pairing page', async () => {
    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/');

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/pair');
  });

  it('answers an unpaired phone’s API request with 401', async () => {
    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/api/notes');

    const body = await json<ApiErrorBody>(res, 401);
    expect(body.error.code).toBe('unauthorized');
  });

  it('treats a request with no known sender as an unpaired phone', async () => {
    const res = await t.raw('GET', '/api/health', { headers: { host: LAN_HOST } });

    expect(res.status).toBe(401);
  });

  it('does not let a phone claim to be the computer by sending a localhost Host header', async () => {
    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/api/notes', undefined, {
      host: `127.0.0.1:${TEST_PORT}`,
    });

    expect(res.status).toBe(401);
  });

  it('still refuses a Host that is not one of the computer’s addresses', async () => {
    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/api/health', undefined, {
      host: 'evil.example:4317',
    });

    expect(res.status).toBe(403);
  });

  it('shows the pairing form to an unpaired phone', async () => {
    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/pair');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('name="code"');
  });

  it('serves the pairing page’s stylesheet to an unpaired phone', async () => {
    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/pair/style.css');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('pairs a phone with a code, then lets it use the API', async () => {
    const cookie = await pairPhone();

    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/api/health', undefined, { cookie });

    expect(cookie).toMatch(/^moss_session=/);
    expect(res.status).toBe(200);
  });

  it('sets a cookie that scripts cannot read and other sites cannot send', async () => {
    const { code } = phone.issueCode();

    const res = await t.callFrom(PHONE_ADDRESS, 'GET', `/pair?code=${code}`);

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
  });

  it('accepts a code typed in lower case', async () => {
    const { code } = phone.issueCode();

    const res = await t.callFrom(PHONE_ADDRESS, 'GET', `/pair?code=${code.toLowerCase()}`);

    expect(res.status).toBe(303);
  });

  it('refuses a wrong code with a message and no cookie', async () => {
    phone.issueCode();

    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/pair?code=WRONGWRONG');

    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).toContain('That code isn&#39;t right');
  });

  it('refuses a code twice', async () => {
    const { code } = phone.issueCode();
    await t.callFrom(PHONE_ADDRESS, 'GET', `/pair?code=${code}`);

    const again = await t.callFrom(PHONE_ADDRESS, 'GET', `/pair?code=${code}`);

    expect(again.status).toBe(400);
    expect(await again.text()).toContain('expired');
  });

  it('locks pairing after repeated wrong codes', async () => {
    phone.issueCode();
    for (let guess = 0; guess < 10; guess++) {
      await t.callFrom(PHONE_ADDRESS, 'GET', '/pair?code=WRONGWRONG');
    }

    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/pair?code=WRONGWRONG');

    expect(res.status).toBe(429);
  });

  it('does not let a paired phone change phone access', async () => {
    const cookie = await pairPhone();

    for (const [method, path, body] of [
      ['GET', '/api/phone', undefined],
      ['PUT', '/api/phone', { enabled: false }],
      ['POST', '/api/phone/code', undefined],
      ['DELETE', '/api/phone/devices', undefined],
    ] as const) {
      const res = await t.callFrom(PHONE_ADDRESS, method, path, body, { cookie });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('makes a pairing code with a link per address for the computer', async () => {
    const made = await json<PairingCode>(await computer('POST', '/api/phone/code'));

    expect(made.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(made.urls).toEqual([`http://${LAN_HOST}/pair?code=${made.code.replace('-', '')}`]);
    expect(Date.parse(made.expiresAt)).toBeGreaterThan(0);
  });

  it('lists a paired device and removes it, which ends its access', async () => {
    const cookie = await pairPhone();
    const status = await json<PhoneStatus>(await computer('GET', '/api/phone'));
    const [device] = status.devices;
    expect(device?.name).toBe('iPhone (Safari)');

    expect((await computer('DELETE', `/api/phone/devices/${device?.id ?? ''}`)).status).toBe(204);

    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/api/health', undefined, { cookie });
    expect(res.status).toBe(401);
    expect((await computer('DELETE', '/api/phone/devices/missing')).status).toBe(404);
  });

  it('removes every device at once', async () => {
    const cookie = await pairPhone();

    const result = await json<{ removed: number }>(await computer('DELETE', '/api/phone/devices'));

    expect(result.removed).toBe(1);
    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/api/health', undefined, { cookie });
    expect(res.status).toBe(401);
  });

  it('shuts the phones out again when turned off', async () => {
    const cookie = await pairPhone();

    await computer('PUT', '/api/phone', { enabled: false });

    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/api/health', undefined, { cookie });
    expect(res.status).toBe(403);
  });

  it('keeps a device paired when phone access is turned off and on again', async () => {
    const cookie = await pairPhone();
    await computer('PUT', '/api/phone', { enabled: false });
    await computer('PUT', '/api/phone', { enabled: true });

    const res = await t.callFrom(PHONE_ADDRESS, 'GET', '/api/health', undefined, { cookie });

    expect(res.status).toBe(200);
  });
});
