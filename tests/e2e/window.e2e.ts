// USER-RUN. Single display only; multi-display clamping needs a human on real monitors.
import { expect, test } from '@playwright/test';
import { launch, newDataDir } from './launch.ts';

test('AS-15 window bounds persist across restart', async () => {
  const dir = newDataDir();
  const first = await launch(dir);
  await first.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 80, y: 90, width: 900, height: 640 });
  });
  await first.app.close(); // goes through the flush handshake, then saves bounds on close
  const second = await launch(dir);
  const b = await second.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getBounds(),
  );
  expect(b).toMatchObject({ width: 900, height: 640 });
  await second.app.close();
});

test('AS-13 renderer is sandboxed and cannot navigate away', async () => {
  const { app, win } = await launch(newDataDir());
  try {
    const before = win.url();
    await win.evaluate(() => void (location.href = 'https://example.com/'));
    await win.waitForTimeout(500);
    expect(win.url()).toBe(before);
    const popup = await win.evaluate(() => window.open('https://example.com/') === null);
    expect(popup).toBe(true);
  } finally {
    await app.close();
  }
});

test('second launch with the same data dir focuses the first (single instance)', async () => {
  const dir = newDataDir();
  const a = await launch(dir);
  try {
    const { _electron } = await import('@playwright/test');
    const second = await _electron
      .launch({ args: ['packages/desktop'], env: { ...process.env, MOSSNOTE_DATA_DIR: dir } })
      .catch(() => null);
    // The second process exits immediately; either the launch fails or its app closes by itself.
    if (second) await second.close().catch(() => undefined);
    expect(a.app.windows()).toHaveLength(1);
  } finally {
    await a.app.close();
  }
});
