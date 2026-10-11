import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { servePages, type PagesSite } from './pagesServer';

const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'dist',
  'standalone',
);

/** The built web version, served the way GitHub Pages serves a project site. One per worker. */
export const test = base.extend<{ at: (route?: string) => string }, { site: PagesSite }>({
  site: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      if (!fs.existsSync(path.join(dist, 'index.html'))) {
        throw new Error('dist/standalone is missing. Run "npm run build:standalone" first.');
      }
      const site = await servePages(dist);
      await use(site);
      await site.close();
    },
    { scope: 'worker' },
  ],
  /** The full address of a page of the site: `at('journal')` is `http://127.0.0.1:1234/mossnote/journal`. */
  at: async ({ site }, use) => {
    await use((route = '') => `${site.origin}${site.base}${route}`);
  },
});

export { expect };

/**
 * Whether the documentation is part of the build. The checks that publish the site
 * (`MOSS_EXPECT_BASE` is set, as `npm run verify:pages` and the workflows do) require it; a plain
 * `npm run test:e2e` does not build it, so those tests are skipped there.
 */
export const docsBuilt = fs.existsSync(path.join(dist, 'docs', 'index.html'));
export const docsRequired = Boolean(process.env.MOSS_EXPECT_BASE);
