// USER-RUN. AS-8: axe over real screens (jsdom cannot judge contrast) and the reduced-motion rule.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { launch, mod, newDataDir } from './launch.ts';

test('axe finds no serious or critical violations, in both themes', async () => {
  const { app, win } = await launch(newDataDir());
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await win.emulateMedia({ colorScheme: scheme });
      await win.keyboard.press(`${mod}+n`);
      await win.locator('.cm-content').click();
      await win.keyboard.type('hello');
      for (const screen of ['shell', 'palette']) {
        if (screen === 'palette') await win.keyboard.press(`${mod}+k`);
        const r = await new AxeBuilder({ page: win }).analyze();
        const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${scheme}/${screen}: ${v.id}`)).toEqual([]);
        if (screen === 'palette') await win.keyboard.press('Escape');
      }
    }
  } finally {
    await app.close();
  }
});

test('reduced motion zeroes transitions', async () => {
  const { app, win } = await launch(newDataDir());
  try {
    await win.emulateMedia({ reducedMotion: 'reduce' });
    const d = await win.evaluate(() => getComputedStyle(document.body).transitionDuration);
    expect(d === '0s' || d === '').toBe(true);
  } finally {
    await app.close();
  }
});
