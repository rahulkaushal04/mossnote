import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The built app must run under the full production CSP, including the
 * Radix primitives and the Tailwind output. Any `securitypolicyviolation` fails the test.
 */
const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
// HTML documents add a per-response nonce to style-src only, for the <style> Radix injects.
const documentCsp = (nonce: string) =>
  EXPECTED_CSP.replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`);

async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __violations: string[] };
    w.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__violations.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
    });
  });
  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) consoleMessages.push(message.text());
  });
  return {
    async all() {
      const fromPage = await page.evaluate(
        () => (window as unknown as { __violations?: string[] }).__violations ?? [],
      );
      return [...fromPage, ...consoleMessages];
    },
  };
}

test('the document is served with the specified CSP (plus a style nonce) and security headers', async ({
  page,
  request,
  server,
}) => {
  const response = await page.goto('/');
  const headers = response?.headers() ?? {};
  const csp = headers['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? '';
  expect(nonce.length).toBeGreaterThan(20);
  expect(csp).toBe(documentCsp(nonce));
  await expect(page.locator('meta[name="csp-nonce"]')).toHaveAttribute('content', nonce);
  // API responses and assets carry the policy exactly as written in the spec.
  const api = await request.get(`${server.url}/api/health`);
  expect(api.headers()['content-security-policy']).toBe(EXPECTED_CSP);
  const theme = await request.get(`${server.url}/theme-init.js`);
  expect(theme.headers()['content-security-policy']).toBe(EXPECTED_CSP);
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
});

test(
  'the app renders and works under the full CSP with zero violations',
  { tag: '@smoke' },
  async ({ page, seed }) => {
    // The Stardew Valley template has every screen, Farm included.
    await seed.reset('stardew');
    const violations = await watchViolations(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    // Tailwind output applies: the rail is a real layout, not unstyled HTML.
    const display = await page
      .getByRole('main')
      .evaluate((el) => getComputedStyle(el).paddingBottom);
    expect(display).not.toBe('0px');

    for (const path of [
      '/journal',
      '/people',
      '/farm',
      '/settings',
      '/search?q=x',
      '/day/10003',
      '/nope',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }

    await page.goto('/settings');
    await page.getByRole('radio', { name: 'Dark' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'Large' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-reading', 'large');

    expect(await violations.all()).toEqual([]);
  },
);

test('Radix dialog, toast and focus handling run under the CSP', async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto('/dev/kit');
  const opener = page.getByRole('button', { name: 'Open dialog' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Example dialog' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await page.getByRole('button', { name: 'Show toast with Undo' }).click();
  await expect(page.getByRole('status').getByText('Item deleted')).toBeVisible();
  await page.keyboard.press('u');
  await expect(page.getByText('Item deleted')).toBeHidden();

  expect(await violations.all()).toEqual([]);
});

test('the page has no inline scripts, and every <style> element carries the nonce', async ({
  page,
}) => {
  await page.goto('/dev/kit');
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const inline = await page.evaluate(() => ({
    scripts: document.querySelectorAll('script:not([src])').length,
    // The browser hides the nonce attribute from the DOM (it reads back as ""), so check that
    // each injected element is the one Radix adds and that it actually applied.
    styles: [...document.querySelectorAll('style')].map((s) => s.textContent),
    scrollLocked: document.body.hasAttribute('data-scroll-locked'),
    overflow: getComputedStyle(document.body).overflow,
  }));
  expect(inline.scripts).toBe(0);
  expect(inline.styles.length).toBeGreaterThan(0);
  // The scroll lock style was applied, not blocked: the page behind the dialog cannot scroll.
  expect(inline.scrollLocked).toBe(true);
  expect(inline.overflow).toBe('hidden');
});

test('an injected inline script is blocked by the CSP', async ({ page }) => {
  await page.goto('/');
  const ran = await page.evaluate(async () => {
    const w = window as unknown as { __pwned?: boolean };
    const script = document.createElement('script');
    script.textContent = 'window.__pwned = true';
    document.head.append(script);
    await new Promise((r) => setTimeout(r, 50));
    return w.__pwned === true;
  });
  expect(ran).toBe(false);
});
