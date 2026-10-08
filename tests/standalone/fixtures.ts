import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/**
 * The standalone web app (`dist/standalone`, from `npm run build:standalone`) served by Vite's
 * preview server, the way a static host would serve it. One site per Playwright worker. Each
 * test gets a fresh browser context, so each starts with empty browser storage.
 */
export const test = base.extend<object, { site: { url: string } }>({
  site: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      if (!fs.existsSync(path.join(root, 'dist', 'standalone', 'index.html'))) {
        throw new Error('dist/standalone is missing. Run "npm run build:standalone" first.');
      }
      const port = await freePort();
      const server: PreviewServer = await preview({
        root: path.join(root, 'src', 'web'),
        mode: 'standalone',
        configFile: path.join(root, 'vite.config.ts'),
        preview: { host: '127.0.0.1', port, strictPort: true },
        logLevel: 'error',
      });
      await use({ url: `http://127.0.0.1:${port}` });
      await server.close();
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ site }, use) => {
    await use(site.url);
  },
});

export { expect };
