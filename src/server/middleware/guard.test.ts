import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, TEST_HOST, type TestApp } from '../testing/app';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(() => {
  t.close();
});

/** Every route the server exposed when this test was written, with a valid body for the mutating ones. */
const ROUTES: { method: string; path: string; body?: unknown }[] = [
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/settings' },
  { method: 'PATCH', path: '/api/settings', body: { prefs: { readingSize: 'large' } } },
  { method: 'GET', path: '/api/does-not-exist' },
  { method: 'POST', path: '/api/does-not-exist', body: {} },
  { method: 'GET', path: '/' },
];

const expectForbidden = async (res: Response) => {
  expect(res.status).toBe(403);
  const body = (await res.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe('forbidden');
};

describe('Host allow-list (every request, including GET and HEAD)', () => {
  const BAD_HOSTS = [
    'evil.example',
    'evil.example:4317',
    '127.0.0.1',
    'localhost',
    '127.0.0.1:9999',
    '127.0.0.1.evil.example:4317',
    'localhost:4317.evil.example',
    '0.0.0.0:4317',
    '192.168.1.5:4317',
    '',
  ];

  for (const route of ROUTES) {
    it(`${route.method} ${route.path} refuses bad hosts`, async () => {
      for (const host of BAD_HOSTS) {
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-moss-client': 'web',
        };
        if (host) headers.host = host;
        await expectForbidden(
          await t.raw(route.method, route.path, {
            headers,
            ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
          }),
        );
      }
    });
  }

  it('refuses a request with no Host header', async () => {
    await expectForbidden(await t.raw('GET', '/api/health'));
  });

  it('refuses HEAD with a bad host', async () => {
    const res = await t.raw('HEAD', '/api/health', { headers: { host: 'evil.example:4317' } });
    expect(res.status).toBe(403);
  });

  it('accepts the three loopback hosts, case-insensitively', async () => {
    for (const host of ['127.0.0.1:4317', 'localhost:4317', '[::1]:4317', 'LOCALHOST:4317']) {
      const res = await t.raw('GET', '/api/health', { headers: { host } });
      expect(res.status, host).toBe(200);
    }
  });

  it('accepts the Vite dev origin only when running in development', async () => {
    const prod = await t.raw('GET', '/api/health', { headers: { host: 'localhost:5173' } });
    expect(prod.status).toBe(403);
    const dev = await makeTestApp({ config: { dev: true } });
    for (const host of ['localhost:5173', '127.0.0.1:5173', '127.0.0.1:4317']) {
      const res = await dev.raw('GET', '/api/health', { headers: { host } });
      expect(res.status, host).toBe(200);
    }
    dev.close();
  });

  it('follows a non-default port', async () => {
    const other = await makeTestApp({ config: { port: 5555 } });
    expect(
      (await other.raw('GET', '/api/health', { headers: { host: '127.0.0.1:5555' } })).status,
    ).toBe(200);
    expect(
      (await other.raw('GET', '/api/health', { headers: { host: '127.0.0.1:4317' } })).status,
    ).toBe(403);
    other.close();
  });
});

describe('Origin', () => {
  const BAD_ORIGINS = [
    'https://evil.example',
    'http://evil.example',
    'null',
    'http://127.0.0.1:4317.evil.example',
    'https://127.0.0.1:4317',
    'http://localhost:4317', // not equal to the Host the request used
    'http://127.0.0.1:9999',
  ];

  for (const route of ROUTES) {
    it(`${route.method} ${route.path} refuses a foreign Origin`, async () => {
      for (const origin of BAD_ORIGINS) {
        const res = await t.call(route.method, route.path, route.body, { origin });
        expect(res.status, origin).toBe(403);
      }
    });
  }

  it('accepts an Origin equal to the app origin, and no Origin at all', async () => {
    expect(
      (await t.call('GET', '/api/health', undefined, { origin: `http://${TEST_HOST}` })).status,
    ).toBe(200);
    expect((await t.call('GET', '/api/health')).status).toBe(200);
    const local = await t.call('GET', '/api/health', undefined, {
      host: 'localhost:4317',
      origin: 'http://localhost:4317',
    });
    expect(local.status).toBe(200);
  });
});

describe('X-Moss-Client and Content-Type on non-GET requests', () => {
  const MUTATING = ROUTES.filter((r) => r.method !== 'GET');

  for (const route of MUTATING) {
    it(`${route.method} ${route.path} needs the client header`, async () => {
      const res = await t.raw(route.method, route.path, {
        headers: { host: TEST_HOST, 'content-type': 'application/json' },
        body: JSON.stringify(route.body ?? {}),
      });
      await expectForbidden(res);
      const wrong = await t.raw(route.method, route.path, {
        headers: { host: TEST_HOST, 'content-type': 'application/json', 'x-moss-client': 'other' },
        body: JSON.stringify(route.body ?? {}),
      });
      await expectForbidden(wrong);
    });

    it(`${route.method} ${route.path} needs a JSON content type`, async () => {
      for (const type of [
        undefined,
        'text/plain',
        'application/x-www-form-urlencoded',
        'multipart/form-data',
      ]) {
        const headers: Record<string, string> = { host: TEST_HOST, 'x-moss-client': 'web' };
        if (type) headers['content-type'] = type;
        await expectForbidden(
          await t.raw(route.method, route.path, {
            headers,
            body: JSON.stringify(route.body ?? {}),
          }),
        );
      }
    });
  }

  it('accepts a JSON content type with a charset', async () => {
    const res = await t.call(
      'PATCH',
      '/api/settings',
      { prefs: { readingSize: 'large' } },
      {
        'content-type': 'application/json; charset=utf-8',
      },
    );
    expect(res.status).toBe(200);
  });

  it('does not require the headers on GET and HEAD', async () => {
    expect((await t.raw('GET', '/api/health', { headers: { host: TEST_HOST } })).status).toBe(200);
    expect((await t.raw('HEAD', '/api/health', { headers: { host: TEST_HOST } })).status).toBe(200);
  });

  it('applies to DELETE and PUT as well', async () => {
    for (const method of ['DELETE', 'PUT']) {
      await expectForbidden(await t.raw(method, '/api/settings', { headers: { host: TEST_HOST } }));
    }
  });
});

describe('OPTIONS is always refused (no CORS)', () => {
  for (const route of ROUTES) {
    it(`OPTIONS ${route.path}`, async () => {
      const res = await t.raw('OPTIONS', route.path, {
        headers: {
          host: TEST_HOST,
          origin: 'https://evil.example',
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'x-moss-client, content-type',
        },
      });
      await expectForbidden(res);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  }

  it('is refused even from a same-origin looking request', async () => {
    await expectForbidden(
      await t.raw('OPTIONS', '/api/settings', { headers: { host: TEST_HOST } }),
    );
  });
});

describe('a fully valid request', () => {
  it('passes the guard for every route', async () => {
    for (const route of ROUTES) {
      const res = await t.call(route.method, route.path, route.body);
      expect(res.status, `${route.method} ${route.path}`).not.toBe(403);
    }
  });

  it('never sends CORS headers', async () => {
    const res = await t.call('GET', '/api/settings', undefined, { origin: `http://${TEST_HOST}` });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });
});
