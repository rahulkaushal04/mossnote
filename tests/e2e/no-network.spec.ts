import { test, expect } from './fixtures';

/**
 * No network at runtime: every request that is not to the local
 * server is blocked and recorded, and the test fails if any was attempted.
 */
const ROUTES = [
  '/',
  '/day/10003',
  '/day/oops',
  '/journal',
  '/journal?flag=question&state=open&tag=idea&order=asc',
  '/notes/abc',
  '/people',
  '/people/abc',
  '/farm',
  '/farm/abc',
  '/search?q=lantern',
  '/settings',
  '/tags/idea',
  '/dev/kit',
  '/does-not-exist',
];

test('no non-localhost request is attempted on any route', async ({
  page,
  context,
  server,
  seed,
}) => {
  await seed.reset('stardew');
  const blocked: string[] = [];
  const seen: string[] = [];
  await context.route(
    (url) => url.hostname !== '127.0.0.1',
    async (route) => {
      blocked.push(route.request().url());
      await route.abort();
    },
  );
  page.on('request', (request) => seen.push(request.url()));
  page.on('websocket', (socket) => blocked.push(`websocket ${socket.url()}`));

  for (const path of ROUTES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  // Exercise the interactive primitives too.
  await page.goto('/dev/kit');
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show toast with Undo' }).click();
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Dark' }).check();
  await page.getByRole('radio', { name: 'Large' }).check();
  await page.waitForLoadState('networkidle');

  expect(blocked, `blocked requests: ${blocked.join(', ')}`).toEqual([]);
  const origins = new Set(
    seen
      .filter((u) => !u.startsWith('data:') && !u.startsWith('blob:'))
      .map((u) => new URL(u).origin),
  );
  expect([...origins]).toEqual([server.url]);
});

test('fonts, scripts and styles are all served from the app origin', async ({ page, server }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const entries = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((e) => e.name),
  );
  expect(entries.length).toBeGreaterThan(2);
  for (const url of entries) expect(new URL(url).origin, url).toBe(server.url);
  expect(entries.some((u) => u.endsWith('.woff2'))).toBe(true);
});

test('the app sets no cookies and registers no service worker', async ({ page, context }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Dark' }).check();
  await page.waitForLoadState('networkidle');
  expect(await context.cookies()).toEqual([]);
  const workers = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistrations()).length,
  );
  expect(workers).toBe(0);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  for (const key of keys) expect(key.startsWith('moss:'), key).toBe(true);
});
