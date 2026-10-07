import { test, expect } from './fixtures';

// These tests stop and restart the worker's server, so they run one at a time.
test.describe.configure({ mode: 'serial' });

const json = { 'X-Moss-Client': 'web' };

test('settings survive a clean restart', async ({ server, request }) => {
  const patch = await request.patch(`${server.url}/api/settings`, {
    headers: json,
    data: { prefs: { readingSize: 'large', hintDismissed: true } },
  });
  expect(patch.ok()).toBe(true);
  await server.stop();
  await server.start();
  const settings = (await (await request.get(`${server.url}/api/settings`)).json()) as {
    prefs: { readingSize: string; hintDismissed: boolean };
  };
  expect(settings.prefs).toEqual({ readingSize: 'large', hintDismissed: true });
  await request.patch(`${server.url}/api/settings`, {
    headers: json,
    data: { prefs: { readingSize: 'comfortable', hintDismissed: false } },
  });
});

test('the unreachable page appears when the server stops and the app recovers by itself', async ({
  page,
  server,
}) => {
  await page.goto('/settings');
  await expect(page.getByRole('radio', { name: 'Comfortable' })).toBeChecked();

  await server.stop();
  // Any request that cannot reach the server shows the full-page message.
  // click(), not check(): the page is replaced as soon as the request fails, so there is no
  // radio left to verify afterwards.
  await page.getByRole('radio', { name: 'Large' }).click();
  await expect(page.getByRole('heading', { name: "Can't reach your journal." })).toBeVisible();
  await expect(page.getByText('npm start')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);

  await server.start();
  // Automatic retry every 5 seconds returns to the previous screen.
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible({
    timeout: 12_000,
  });
  // The change that could not be saved was undone.
  await expect(page.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
});

test('a killed server (SIGKILL during a burst of writes) restarts with an intact journal', async ({
  server,
  request,
}) => {
  const writes = Array.from({ length: 150 }, (_, i) =>
    request
      .patch(`${server.url}/api/settings`, {
        headers: json,
        data: { prefs: { readingSize: i % 2 === 0 ? 'large' : 'comfortable' } },
      })
      .catch(() => undefined),
  );
  await new Promise((r) => setTimeout(r, 40));
  await server.kill();
  await Promise.all(writes);

  // The stale lock left by the killed process must not block the next start.
  await server.start();
  const health = await request.get(`${server.url}/api/health`);
  expect(health.ok()).toBe(true);
  const settings = await request.get(`${server.url}/api/settings`);
  expect(settings.ok()).toBe(true);
  const body = (await settings.json()) as {
    calendar: { seasons: unknown[] };
    prefs: { readingSize: string };
  };
  expect(body.calendar.seasons).toHaveLength(4);
  expect(['large', 'comfortable']).toContain(body.prefs.readingSize);
});
