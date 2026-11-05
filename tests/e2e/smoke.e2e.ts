// USER-RUN (needs a launchable Electron): npm run test:e2e
import { expect, test } from '@playwright/test';
import { launch, newDataDir } from './launch.ts';

type W = {
  mossnote: Record<string, unknown> & {
    ping(m: string): Promise<string>;
    fts5Probe(): Promise<boolean>;
    rpc(m: string, a?: unknown): Promise<{ ok: boolean; value?: unknown }>;
  };
  require: unknown;
  process: unknown;
};

test('electron smoke', async () => {
  const { app, win } = await launch(newDataDir());
  try {
    await expect(win.locator('body')).toContainText('Mossnote');
    expect(await win.evaluate(() => (window as unknown as W).mossnote.ping('hi'))).toBe('pong:hi');
    expect(await win.evaluate(() => (window as unknown as W).mossnote.fts5Probe())).toBe(true);
    expect(
      await win.evaluate(() => [
        typeof (window as unknown as W).require,
        typeof (window as unknown as W).process,
      ]),
    ).toEqual(['undefined', 'undefined']);
    // The bridge exposes only rpc/onEvent (+ the smoke probes), and rpc answers.
    expect(await win.evaluate(() => Object.keys((window as unknown as W).mossnote).sort())).toEqual(
      ['fts5Probe', 'onEvent', 'ping', 'rpc'],
    );
    expect(
      await win.evaluate(
        async () => (await (window as unknown as W).mossnote.rpc('app.status', {})).ok,
      ),
    ).toBe(true);
    // Prototype names are refused, not dispatched.
    expect(
      await win.evaluate(
        async () => (await (window as unknown as W).mossnote.rpc('__proto__', {})).ok,
      ),
    ).toBe(false);
  } finally {
    await app.close();
  }
});
