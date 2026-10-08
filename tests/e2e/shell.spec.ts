import { test, expect } from './fixtures';

test.describe('first launch', () => {
  test(
    'opens an empty shell: no wizard, no sample data',
    { tag: '@smoke' },
    async ({ page, request, server }) => {
      await page.goto('/');
      await expect(page).toHaveTitle('Today · Mossnote');
      await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
      await expect(page.getByText('Nothing written today.')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const nav = page.getByRole('navigation', { name: 'Primary' });
      await expect(nav.getByRole('link')).toHaveText([
        'Today',
        'Journal',
        'People',
        'Maps',
        'Settings',
      ]);

      // The journal is empty, with no seasons, no Farm and no quick actions.
      const settings = (await (await request.get(`${server.url}/api/settings`)).json()) as {
        calendar: { seasons: { name: string; days: number }[]; counter?: boolean };
        currentGameDate: number | null;
      };
      expect(settings.currentGameDate).toBeNull();
      expect(settings.calendar.counter).toBe(true);
      expect(settings.calendar.seasons.map((s) => `${s.name} ${s.days}`)).toEqual(['Day 99']);
      await expect(page.getByRole('group', { name: 'Quick actions' })).toHaveCount(0);
    },
  );

  test('a Stardew Valley journal has its own sections, Farm and seasons', async ({
    page,
    request,
    server,
    seed,
  }) => {
    await seed.reset('stardew');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link')).toHaveText([
      'Today',
      'Daily journal',
      'NPCs',
      'Farm',
      'Maps',
      'Settings',
    ]);
    const settings = (await (await request.get(`${server.url}/api/settings`)).json()) as {
      calendar: { seasons: { name: string; days: number }[] };
    };
    expect(settings.calendar.seasons.map((s) => `${s.name} ${s.days}`)).toEqual([
      'Spring 28',
      'Summer 28',
      'Fall 28',
      'Winter 28',
    ]);
    await nav.getByRole('link', { name: 'Farm' }).click();
    await expect(
      page.getByText('Nothing here yet. Add a crop when you plant something.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Farm', exact: true }).first()).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('each destination shows its empty-state copy', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.getByRole('link', { name: 'Journal' }).click();
    await expect(page.getByText('Your journal starts with your first note.')).toBeVisible();
    await nav.getByRole('link', { name: 'People' }).click();
    await expect(
      page.getByText('No people yet. Add someone above, or type @ in a note.'),
    ).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Farm' })).toHaveCount(0);
  });
});

test.describe('keyboard', () => {
  test('the first Tab stop is the skip link, and it moves focus to the main content', async ({
    page,
  }) => {
    // Today puts focus in the note box on load, so start on a page that does not.
    await page.goto('/journal');
    await expect(page.getByRole('heading', { level: 1, name: 'Journal' })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('focus moves to the page heading after navigating by keyboard', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.getByRole('link', { name: 'Journal' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Journal' })).toBeFocused();
  });

  test('focus is visible with a 2px outline', async ({ page }) => {
    await page.goto('/journal');
    await expect(page.getByRole('heading', { level: 1, name: 'Journal' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    const outline = await page.getByRole('link', { name: 'Skip to content' }).evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, style: style.outlineStyle, offset: style.outlineOffset };
    });
    expect(outline).toEqual({ width: '2px', style: 'solid', offset: '2px' });
  });
});

test.describe('responsive layout', () => {
  const ROUTES = [
    '/',
    '/journal',
    '/people',
    '/farm',
    '/settings',
    '/search?q=lantern',
    '/dev/kit',
    '/nowhere',
  ];
  const WIDTHS = [320, 360, 768, 899, 900, 1280, 1920];

  for (const width of WIDTHS) {
    test(`no horizontal page scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ROUTES) {
        await page.goto(route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} at ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('sidebar from 900px, icon rail from 640px, floating bottom bar below, never two', async ({
    page,
  }) => {
    // The panels have a margin of 8px around them, which the boxes do not include.
    for (const [width, kind, boxWidth] of [
      [360, 'dock', 344],
      [639, 'dock', 623],
      [640, 'rail', 64],
      [899, 'rail', 64],
      [900, 'sidebar', 232],
      [1280, 'sidebar', 232],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Primary' });
      await expect(nav, `${width}px`).toHaveCount(1);
      const box = await nav.boundingBox();
      expect(box?.width, `${width}px ${kind}`).toBe(boxWidth);
      if (kind === 'dock') {
        // Floating: a margin at the bottom, not flush with the edge.
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(800);
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(780);
      } else {
        expect(box?.x).toBe(8);
      }
    }
  });

  test('the content column is 44rem at most and centred in the space beside the sidebar', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 800, height: 900 },
      { width: 1280, height: 900 },
      { width: 1920, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const main = await page.getByRole('main').boundingBox();
      expect(main?.width, `${viewport.width}px`).toBeLessThanOrEqual(704);
    }
    // At 1920 it is wider than it is allowed to be, so it must sit in the middle of what is left.
    const main = await page.getByRole('main').boundingBox();
    const nav = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
    const left = (main?.x ?? 0) - ((nav?.x ?? 0) + (nav?.width ?? 0));
    const right = 1920 - ((main?.x ?? 0) + (main?.width ?? 0));
    expect(Math.abs(left - right)).toBeLessThanOrEqual(10);
  });

  test('a phone reaches Settings and the journals from the More tab', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'More' });
    await expect(sheet.getByRole('button', { name: 'New journal…' })).toBeVisible();
    await sheet.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(sheet).toBeHidden();
  });

  test('200% zoom stays usable (equivalent to a 640px wide viewport)', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await page.goto('/settings');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('touch targets on coarse pointers', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 851 } });

  test('navigation and controls are at least 44 by 44', async ({ page }) => {
    await page.goto('/');
    for (const link of await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link')
      .all()) {
      const box = await link.boundingBox();
      expect(box?.height, (await link.textContent()) ?? '').toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    await page.goto('/settings');
    for (const label of await page.locator('label.tap').all()) {
      const box = await label.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('theme', () => {
  test('a stored theme is applied before first paint, with no flash', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('moss:theme', 'dark');
      const seen: string[] = [];
      (window as unknown as { __themes: string[] }).__themes = seen;
      new MutationObserver(() => {
        seen.push(document.documentElement.getAttribute('data-theme') ?? '');
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const seen = await page.evaluate(() => (window as unknown as { __themes: string[] }).__themes);
    // The blocking script set it once; React never flipped it to light and back.
    expect(seen.every((t) => t === 'dark')).toBe(true);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(20, 24, 22)');
  });

  test('System follows the operating system, live', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('an explicit choice persists across reloads and beats the system', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/settings');
    await page.getByRole('radio', { name: 'Dark' }).check();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await page.getByRole('radio', { name: 'System' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('colour-scheme follows the theme so form controls and scrollbars match', async ({
    page,
  }) => {
    await page.goto('/settings');
    await page.getByRole('radio', { name: 'Dark' }).check();
    expect(await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme)).toBe(
      'dark',
    );
    await page.getByRole('radio', { name: 'Light' }).check();
    expect(await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme)).toBe(
      'light',
    );
  });

  test('uses the bundled fonts, not remote ones', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await page.evaluate(async () => document.fonts.ready);
    const families = await page.evaluate(() =>
      [...document.fonts].map((f) => `${f.family.replaceAll('"', '')} ${f.status}`),
    );
    expect(families).toContain('Inter Variable loaded');
  });
});
