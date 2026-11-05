// @vitest-environment jsdom
// SR-10 / AS-8: axe over every search state in both themes. REAL timers for axe (it hangs under
// vitest fake timers); the app itself uses manual timers. Contrast is judged by contrast.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootApp, runAxe, serious, seed, text, type Booted } from './helpers/app';
import { byText, click, waitFor } from './helpers/dom';
import { box, rows, search } from './helpers/search';
import { makeEnv, type Env } from './helpers/workspace';

const INDEX = readFileSync(join(__dirname, '../index.html'), 'utf8');
beforeEach(() => {
  document.documentElement.lang = /<html lang="([\w-]+)"/.exec(INDEX)?.[1] ?? '';
  document.title = /<title>([^<]+)<\/title>/.exec(INDEX)?.[1] ?? '';
});
let env: Env | undefined;
let b: Booted | undefined;
afterEach(async () => {
  await b?.m.unmount();
  env?.cleanup();
  b = env = undefined;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

type Theme = 'light' | 'dark';
const scenarios: { name: string; run(e: Env, theme: Theme): Promise<void> }[] = [
  {
    name: 'idle (empty query, hint, note list)',
    async run(e, theme) {
      await seed(e, 'Alpha');
      b = await bootApp(e, { theme });
      expect(text()).toContain('Searching in: All notes');
    },
  },
  {
    name: 'results with highlighted snippets and filters',
    async run(e, theme) {
      await seed(e, 'Okapi one\nthe okapi is shy', 'Okapi two');
      b = await bootApp(e, { theme });
      await search(b, 'okapi');
      expect(rows()).toHaveLength(2);
      expect(document.querySelector('mark')).not.toBeNull();
    },
  },
  {
    name: 'no results with a core message',
    async run(e, theme) {
      await seed(e, 'Alpha');
      b = await bootApp(e, { theme });
      await search(b, 'zzzz tag:ghost');
      expect(text()).toContain('No notes match');
    },
  },
  {
    name: 'rebuilding with progress',
    async run(e, theme) {
      await seed(e, 'Alpha');
      b = await bootApp(e, { theme });
      e.bridge.inject('search.run', {
        ok: true,
        value: { state: 'rebuilding', progress: { done: 1, total: 3 }, hits: [], messages: [] },
      });
      e.bridge.inject('search.status', {
        ok: true,
        value: { state: 'rebuilding', progress: { done: 1, total: 3 } },
      });
      await search(b, 'alpha', () => !!document.querySelector('progress'));
    },
  },
  {
    name: 'error with Retry',
    async run(e, theme) {
      await seed(e, 'Alpha');
      b = await bootApp(e, { theme });
      e.bridge.inject('search.run', { ok: false, error: { code: 'internal', message: 'down' } });
      await search(b, 'alpha', () => !!document.querySelector('.search-results [role=alert]'));
    },
  },
  {
    name: 'index error with Retry (hostile text stays text)',
    async run(e, theme) {
      await seed(e, 'Alpha');
      b = await bootApp(e, { theme });
      e.bridge.inject('search.run', {
        ok: true,
        value: { state: 'error', hits: [], messages: ['bad <b>index</b>'] },
      });
      await search(b, 'alpha', () => !!document.querySelector('.search-results [role=alert]'));
      expect(document.querySelector('.search-index-error')!.textContent).toBe('bad <b>index</b>');
    },
  },
  {
    name: 'several tag and folder chips',
    async run(e, theme) {
      await seed(e, 'Alpha');
      b = await bootApp(e, { theme });
      await search(b, 'alpha');
      b.model().search.setFilters({ tagIds: ['t1', 't2'], folderIds: ['f1'] });
      await waitFor(() => !!document.querySelector('[aria-label="Applied filters"]'), 'chips');
    },
  },
  {
    name: 'save-search dialog open',
    async run(e, theme) {
      await seed(e, 'Alpha');
      b = await bootApp(e, { theme });
      await search(b, 'alpha');
      await click(byText(document.body, 'Save search'));
      expect(document.querySelector('[role=dialog] input')).not.toBeNull();
    },
  },
  {
    name: 'saved searches list, delete confirmation and corrupt store',
    async run(e, theme) {
      await seed(e, 'Alpha');
      await e.bridge.rpc('search.saved.create', { name: 'First', spec: { query: 'alpha' } });
      b = await bootApp(e, { theme });
      await waitFor(() => !!byText(document.body, 'First'), 'saved list');
      await click(document.querySelector('[aria-label="Delete saved search First"]'));
      expect(document.querySelector('[role=alertdialog]')).not.toBeNull();
    },
  },
  {
    name: 'corrupt saved-search store',
    async run(e, theme) {
      e.ws.store.db.prepare("INSERT INTO meta(key, value) VALUES ('saved_searches', '{x')").run();
      b = await bootApp(e, { theme });
      await waitFor(() => !!byText(document.body, 'Reset saved searches'), 'reset action');
    },
  },
];

describe.each<Theme>(['light', 'dark'])('search axe, %s theme', (theme) => {
  it.each(scenarios.map((s) => [s.name, s] as const))(
    '%s has no serious or critical violations',
    async (_n, s) => {
      env = makeEnv();
      await s.run(env, theme);
      expect(document.documentElement.dataset.theme).toBe(theme);
      expect(box()).not.toBeNull();
      expect(serious(await runAxe())).toEqual([]);
    },
    60_000,
  );
});
