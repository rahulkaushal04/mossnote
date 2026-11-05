// @vitest-environment jsdom
// SR-4 (UI part), SR-5, SR-6, SR-7, SR-10, SR-11, AS-9. Real temp-dir Workspace behind the real
// dispatcher and the structuredClone loopback; manual timers drive the debounce. No expect() runs
// inside a callback that something else invokes: tests record, then assert.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { bootApp, noteOptions, seed, text, treeItem, typeInto, type Booted } from './helpers/app';
import { byText, click, press, settle, waitFor } from './helpers/dom';
import {
  advance,
  box,
  choose,
  delayRuns,
  field,
  lastRun,
  rows,
  runCalls,
  search,
  status,
} from './helpers/search';
import { makeEnv, type Env } from './helpers/workspace';
import {
  dayEnd,
  dayStart,
  fixedZone,
  fromCoreFilters,
  toCoreFilters,
  NO_FILTERS,
  MAX_ROWS,
  type DayZone,
} from '../src/search/searchStore';
import { segments } from '../src/search/Highlighted';
import { commands } from '../src/commands/manifest';

let env: Env | undefined;
let b: Booted | undefined;
afterEach(async () => {
  await b?.m.unmount();
  env?.cleanup();
  b = env = undefined;
  document.documentElement.removeAttribute('data-theme');
});
const titles = () => rows().map((r) => r.querySelector('.hit-title')!.textContent);
const dialog = () => document.querySelector<HTMLElement>('[role=dialog], [role=alertdialog]');
const sql = (e: Env) => e.ws.store.db;

describe('search box, debounce, stale replies (SR-3 UI part)', () => {
  it('is a labelled search landmark with a type=search input and a visible scope label', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    b = await bootApp(env);
    const input = box();
    expect(input.type).toBe('search');
    expect(input.labels?.[0]?.textContent).toBe('Search notes');
    expect(input.closest('[role=search]')).not.toBeNull();
    expect(text()).toContain('Searching in: All notes');
    // Empty query: the hint and the normal note list.
    expect(text()).toContain('Use “quotes” for a phrase');
    expect(noteOptions()).toHaveLength(1);
    expect(rows()).toHaveLength(0);
  });

  it('five keystrokes inside 150 ms make exactly one search.run', async () => {
    env = makeEnv();
    await seed(env, 'apple pie');
    b = await bootApp(env);
    for (const q of ['a', 'ap', 'app', 'appl', 'apple']) {
      await typeInto(box(), q);
      await advance(b, 20);
    }
    expect(runCalls(env)).toHaveLength(0);
    await advance(b, 150);
    await waitFor(() => rows().length === 1, 'result');
    expect(runCalls(env)).toHaveLength(1);
    expect(runCalls(env)[0]).toMatchObject({ query: 'apple' });
  });

  it('discards a stale reply that arrives after a newer one', async () => {
    env = makeEnv();
    await seed(env, 'alpha one', 'beta two');
    const gate = delayRuns(env, [1]);
    b = await bootApp(env);
    await typeInto(box(), 'alpha');
    await advance(b, 150);
    await typeInto(box(), 'beta');
    await advance(b, 150);
    await waitFor(() => titles().length === 1, 'beta result');
    expect(titles()[0]).toContain('beta two');
    await gate.release(1); // the alpha reply lands late
    await settle(20);
    expect(titles()).toHaveLength(1);
    expect(titles()[0]).toContain('beta two');
    expect(status()).toBe('1 result');
  });

  it('clearing the query returns to the note list and ignores a reply in flight', async () => {
    env = makeEnv();
    await seed(env, 'alpha one');
    const gate = delayRuns(env, [1]);
    b = await bootApp(env);
    await typeInto(box(), 'alpha');
    await advance(b, 150);
    await typeInto(box(), '');
    await gate.release(1);
    await settle(20);
    expect(rows()).toHaveLength(0);
    expect(noteOptions()).toHaveLength(1);
  });
});

describe('keyboard flow (SR-10)', () => {
  async function three() {
    env = makeEnv();
    const ids = await seed(env, 'zed one', 'zed two', 'zed three');
    b = await bootApp(env, { editor: 'real' });
    await search(b, 'zed');
    return ids;
  }

  it('ArrowDown enters the list; Up/Down/Home/End rove tabindex; one tab stop', async () => {
    await three();
    expect(rows()).toHaveLength(3);
    expect(rows().filter((r) => r.tabIndex === 0)).toHaveLength(1);
    await press(box(), 'ArrowDown');
    const first = document.activeElement as HTMLElement;
    expect(first).toBe(rows().find((r) => r.tabIndex === 0));
    await press(first, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[1]);
    await press(rows()[1]!, 'End');
    expect(document.activeElement).toBe(rows()[2]);
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
    await press(rows()[2]!, 'Home');
    expect(document.activeElement).toBe(rows()[0]);
    await press(rows()[0]!, 'ArrowUp'); // above the first row: back to the box
    expect(document.activeElement).toBe(box());
  });

  it('Enter opens the note and moves focus into the editor', async () => {
    await three();
    await press(box(), 'ArrowDown');
    await press(document.activeElement!, 'ArrowDown');
    const id = (document.activeElement as HTMLElement).dataset['id']!;
    await press(document.activeElement!, 'Enter');
    expect(b!.model().store.get().openId).toBe(id);
    await waitFor(() => !!document.activeElement?.closest('.cm-editor'), 'focus in editor');
  });

  it('Esc in the box clears the query; Esc in the list clears and refocuses the box', async () => {
    await three();
    await press(box(), 'Escape');
    expect(box().value).toBe('');
    expect(rows()).toHaveLength(0);
    expect(noteOptions()).toHaveLength(3);
    await search(b!, 'zed');
    await press(box(), 'ArrowDown');
    await press(document.activeElement!, 'Escape');
    expect(box().value).toBe('');
    expect(document.activeElement).toBe(box());
    expect(noteOptions()).toHaveLength(3);
  });

  it('Mod-Alt-f focuses the box; an AltGr event does not; the command is in the manifest', async () => {
    env = makeEnv();
    await seed(env, 'x');
    b = await bootApp(env);
    expect(commands.find((c) => c.id === 'search.focus')?.shortcut).toBe('Mod-Alt-f');
    const ev = (init: KeyboardEventInit) =>
      act(async () => {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'f',
            code: 'KeyF',
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        );
      });
    await ev({ ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(document.activeElement).not.toBe(box());
    await ev({ ctrlKey: true, altKey: true });
    expect(document.activeElement).toBe(box());
  });

  it('Esc in the save dialog closes only the dialog (dialog > search)', async () => {
    env = makeEnv();
    await seed(env, 'zed');
    b = await bootApp(env);
    await search(b, 'zed');
    await click(byText(document.body, 'Save search'));
    expect(dialog()?.getAttribute('role')).toBe('dialog');
    await press(document.activeElement!, 'Escape');
    expect(dialog()).toBeNull();
    expect(box().value).toBe('zed');
    expect(rows()).toHaveLength(1);
  });
});

describe('scope follows the nav (M9)', () => {
  it('root notes, folder subtree, trash, favorites and tag agree with the nav selection', async () => {
    env = makeEnv();
    const call = async (m: string, a: unknown) => {
      const r = await env!.bridge.rpc(m, a);
      if (!r.ok) throw new Error(`${m}: ${r.error.message}`);
      return r.value as { id: string };
    };
    const work = await call('folders.create', { name: 'Work' });
    const sub = await call('folders.create', { name: 'Sub', parentId: work.id });
    const mk = async (body: string, folderId?: string) =>
      (await call('notes.create', { body, ...(folderId ? { folderId } : {}) })).id;
    await mk('root koala');
    await mk('work koala', work.id);
    await mk('sub koala', sub.id);
    const gone = await mk('gone koala');
    const fav = await mk('fav koala');
    await call('notes.trash', { id: gone });
    await call('notes.setFavorite', { id: fav, favorite: true });
    const tag = await call('tags.create', { name: 'zoo' });
    await call('tags.tagNote', { noteId: fav, tagId: tag.id });
    b = await bootApp(env, { ready: () => !!treeItem('Work') });
    await search(b, 'koala');
    expect(titles().sort()).toEqual(['fav koala', 'root koala', 'sub koala', 'work koala']);
    expect(lastRun(env)['scope']).toBeUndefined();

    const settled = (n: number) => () =>
      rows().length === n && b!.model().search.get().status === 'ready';
    await click(treeItem('Work'));
    await waitFor(settled(2), 'folder scope');
    expect(titles().sort()).toEqual(['sub koala', 'work koala']); // the subtree
    expect(lastRun(env)['scope']).toEqual({ kind: 'folder', id: work.id });
    expect(text()).toContain('Searching in: Folder “Work”');

    await act(async () => b!.model().nav.select({ kind: 'folder', id: sub.id })); // Sub is collapsed in the tree
    await waitFor(settled(1), 'subfolder scope');
    expect(titles()).toEqual(['sub koala']);

    await click(treeItem('Favorites'));
    await waitFor(settled(1), 'favorites scope');
    expect(titles()).toEqual(['fav koala']);

    await click(treeItem('Trash'));
    await waitFor(settled(1), 'trash scope');
    expect(titles()).toEqual(['gone koala']); // only trashed notes
    expect(lastRun(env)['scope']).toEqual({ kind: 'trash' });
    expect(text()).toContain('Searching in: Trash');

    b.model().nav.select({ kind: 'tag', id: tag.id });
    await waitFor(settled(1), 'tag scope');
    expect(titles()).toEqual(['fav koala']);
    expect(text()).toContain('Searching in: Tag “zoo”');

    await click(treeItem('All notes'));
    await waitFor(settled(4), 'all again');
  });
});

describe('XSS: results are text and <mark> only (SR-10)', () => {
  it('markup-looking titles and bodies, a forged </mark> and marker control chars stay text', async () => {
    env = makeEnv();
    const evil = '<img src=x onerror="window.__x=1"> needle';
    await seed(
      env,
      `${evil}\n</mark><script>window.__x=2</script> needle \u0002forged\u0003 <b>bold</b>`,
      '<svg onload="window.__x=3"> plain needle',
    );
    b = await bootApp(env);
    await search(b, 'needle');
    expect(rows()).toHaveLength(2);
    const pane = document.querySelector('.search-results')!;
    const tags = new Set([...pane.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()));
    expect([...tags].filter((t) => !['ul', 'li', 'span', 'mark', 'p'].includes(t))).toEqual([]);
    expect(document.querySelector('img, script, svg, b')).toBeNull();
    expect((window as { __x?: number }).__x).toBeUndefined();
    expect(pane.textContent).toContain('<img src=x onerror="window.__x=1">');
    expect(pane.textContent).toContain('</mark><script>');
    expect(pane.textContent).not.toContain('\u0002');
    expect(pane.textContent).not.toContain('\u0003');
    const marks = [...pane.querySelectorAll('mark')].map((m) => m.textContent!.toLowerCase());
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) expect(m).toBe('needle'); // nothing but the query term is highlighted
  });

  it('segments() clamps, sorts and merges hostile ranges', () => {
    const t = 'abcdef';
    const cases: [Array<[number, number]>, string][] = [
      [[[2, 4]], 'ab|cd|ef'],
      [
        [
          [4, 6],
          [0, 2],
        ],
        '|ab|cd|ef|',
      ],
      [
        [
          [1, 3],
          [2, 5],
        ],
        'a|bc||de|f',
      ],
      [
        [
          [-5, 2],
          [4, 99],
        ],
        '|ab|cd|ef|',
      ],
      [
        [
          [3, 3],
          [5, 2],
          [NaN, 1],
        ],
        'abcdef',
      ],
    ];
    const render = (r: Array<[number, number]>) =>
      segments({ text: t, ranges: r })
        .map((s) => (s.mark ? `|${s.text}|` : s.text))
        .join('');
    for (const [r, want] of cases)
      expect(render(r).replace(/\|\|/g, '')).toBe(want.replace(/\|\|/g, ''));
    expect(
      segments({
        text: t,
        ranges: [
          [1, 3],
          [2, 5],
        ],
      })
        .map((s) => s.text)
        .join(''),
    ).toBe(t);
  });

  it('no innerHTML in the search sources', () => {
    const dir = join(__dirname, '../src/search');
    const bad = readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) =>
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/.test(
          readFileSync(join(dir, f), 'utf8'),
        ),
      );
    expect(bad).toEqual([]);
  });
});

describe('announcements and states (SR-10, SR-11)', () => {
  it('announces once after results settle, not on every keystroke', async () => {
    env = makeEnv();
    await seed(env, 'moss one', 'moss two', 'moss three');
    b = await bootApp(env);
    const seen: string[] = [];
    const region = document.querySelector('[role=status].search-status')!;
    const obs = new MutationObserver(() => seen.push(region.textContent ?? ''));
    obs.observe(region, { childList: true, characterData: true, subtree: true });
    for (const q of ['m', 'mo', 'mos', 'moss']) {
      await typeInto(box(), q);
      await advance(b, 10);
    }
    expect(seen).toEqual([]);
    await advance(b, 150);
    await waitFor(() => status() === '3 results', 'announcement');
    await settle(10);
    obs.disconnect();
    expect(seen).toEqual(['3 results']);
    expect(region.getAttribute('aria-live') ?? 'polite').toBe('polite');
  });

  it('shows the empty-result state with the core messages verbatim', async () => {
    env = makeEnv();
    await seed(env, 'moss');
    b = await bootApp(env);
    await search(b, 'nomatchzz tag:ghost');
    expect(rows()).toHaveLength(0);
    expect(text()).toContain('No notes match “nomatchzz tag:ghost”.');
    expect(status()).toBe('No notes match “nomatchzz tag:ghost”');
    const msgs = [...document.querySelectorAll('.search-messages li')].map((l) => l.textContent);
    expect(msgs).toEqual(['No tag named “ghost”.']);
  });

  it('rebuilding: progress is shown, the box stays enabled, ready triggers a re-run', async () => {
    env = makeEnv();
    await seed(env, 'moss');
    b = await bootApp(env);
    env.bridge.inject('search.run', {
      ok: true,
      value: {
        state: 'rebuilding',
        progress: { done: 1, total: 4 },
        hits: [],
        messages: ['The search index is being rebuilt. Results will appear in a moment.'],
      },
    });
    env.bridge.inject('search.status', {
      ok: true,
      value: { state: 'rebuilding', progress: { done: 1, total: 4 } },
    });
    await search(b, 'moss', () => /Rebuilding/.test(text()));
    expect(text()).toContain('Rebuilding the search index… 1 of 4 notes');
    const p = document.querySelector('progress')!;
    expect(p.value).toBe(1);
    expect(p.max).toBe(4);
    expect(status()).toBe('Rebuilding the search index…');
    expect(box().disabled).toBe(false);
    const before = runCalls(env).length;
    b.model().client.call('search.status'); // keep the loopback honest
    env.bridge.emit({ type: 'searchState', state: 'ready' });
    await waitFor(() => rows().length === 1, 'results after ready');
    expect(runCalls(env).length).toBe(before + 1);
    expect(text()).not.toContain('Rebuilding the search index…');
  });

  it('follows searchState events and reads search.status on load', async () => {
    env = makeEnv();
    b = await bootApp(env);
    expect(env.bridge.count('search.status')).toBeGreaterThanOrEqual(1);
    env.bridge.emit({ type: 'searchState', state: 'rebuilding', progress: { done: 2, total: 9 } });
    expect(b.model().search.get().index).toEqual({
      state: 'rebuilding',
      progress: { done: 2, total: 9 },
    });
    env.bridge.emit({ type: 'searchState', state: 'ready' });
    expect(b.model().search.get().index).toEqual({ state: 'ready' });
  });

  it('error: message plus Retry; Retry recovers', async () => {
    env = makeEnv();
    await seed(env, 'moss');
    b = await bootApp(env);
    env.bridge.inject('search.run', {
      ok: false,
      error: { code: 'internal', message: 'index exploded' },
    });
    await search(b, 'moss', () => !!document.querySelector('[role=alert]'));
    expect(document.querySelector('[role=alert]')!.textContent).toContain(
      'Search failed: index exploded',
    );
    expect(rows()).toHaveLength(0);
    await click(byText(document.body, 'Retry'));
    await waitFor(() => rows().length === 1, 'recovered');
    expect(document.querySelector('.search-results [role=alert]')).toBeNull();
    expect(status()).toBe('1 result');
  });
});

describe('filters build the right core params (SR-4 UI part, SR-6)', () => {
  it('toCoreFilters: UTC zone gives UTC bounds, inclusive end of day', () => {
    const utc = fixedZone(0);
    expect(dayStart('2024-01-05', utc)).toBe(Date.UTC(2024, 0, 5));
    expect(dayEnd('2024-01-05', utc)).toBe(Date.UTC(2024, 0, 6) - 1);
    expect(toCoreFilters(NO_FILTERS, utc)).toEqual({});
    expect(
      toCoreFilters(
        {
          ...NO_FILTERS,
          createdFrom: '2024-01-05',
          updatedTo: '2024-02-29',
          favorite: true,
          tagIds: ['t1', 't2'],
          folderIds: ['f1'],
        },
        utc,
      ),
    ).toEqual({
      favorite: true,
      tagIds: ['t1', 't2'],
      folderIds: ['f1'],
      createdFrom: Date.UTC(2024, 0, 5),
      updatedTo: Date.UTC(2024, 1, 29) + 86_400_000 - 1,
    });
    expect(toCoreFilters({ ...NO_FILTERS, createdFrom: 'garbage' }, utc)).toEqual({});
    expect(toCoreFilters({ ...NO_FILTERS, createdFrom: '2024-02-30' }, utc)).toEqual({});
  });

  it('bounds are LOCAL calendar days: UTC+10 and UTC-8 shift the UTC instants', () => {
    const east = fixedZone(600); // local midnight is 14:00 UTC the day before
    expect(dayStart('2024-01-05', east)).toBe(Date.UTC(2024, 0, 4, 14));
    expect(dayEnd('2024-01-05', east)).toBe(Date.UTC(2024, 0, 5, 14) - 1);
    const west = fixedZone(-480); // local midnight is 08:00 UTC
    expect(dayStart('2024-01-05', west)).toBe(Date.UTC(2024, 0, 5, 8));
    expect(dayEnd('2024-01-05', west)).toBe(Date.UTC(2024, 0, 6, 8) - 1);
    // Month and year rollover of the "next midnight".
    expect(dayEnd('2023-12-31', west)).toBe(Date.UTC(2024, 0, 1, 8) - 1);
    expect(dayEnd('2024-02-29', east)).toBe(Date.UTC(2024, 1, 29, 14) - 1);
    // Round trip: the end bound still belongs to the same local day.
    expect(fromCoreFilters({ createdTo: dayEnd('2024-01-05', east)! }, east).createdTo).toBe(
      '2024-01-05',
    );
    expect(fromCoreFilters({ createdFrom: dayStart('2024-01-05', west)! }, west).createdFrom).toBe(
      '2024-01-05',
    );
  });

  it('a DST day is 23 hours long: the end is the next local midnight minus 1 ms, not +24 h', () => {
    // US Pacific 2024: UTC-8 until 10 March 02:00, UTC-7 after. Midnight of a date uses that date's offset.
    const DST = Date.UTC(2024, 2, 10, 10); // 02:00 PST = 10:00 UTC
    const hrs = (h: number) => h * 3_600_000;
    const pacific: DayZone = {
      midnight: (y, m, d) => {
        const t = Date.UTC(y, m - 1, d);
        return t + hrs(t <= Date.UTC(2024, 2, 10) ? 8 : 7);
      },
      day: (ms) => new Date(ms - hrs(ms < DST ? 8 : 7)).toISOString().slice(0, 10),
    };
    const start = dayStart('2024-03-10', pacific)!;
    const end = dayEnd('2024-03-10', pacific)!;
    expect(start).toBe(Date.UTC(2024, 2, 10, 8)); // 00:00 PST
    expect(end).toBe(Date.UTC(2024, 2, 11, 7) - 1); // 23:59:59.999 PDT
    expect(end - start + 1).toBe(23 * 3_600_000);
    expect(fromCoreFilters({ createdTo: end, createdFrom: start }, pacific)).toMatchObject({
      createdFrom: '2024-03-10',
      createdTo: '2024-03-10',
    });
  });

  it('the default zone is the local one (matches new Date(y, m, d))', () => {
    expect(dayStart('2024-06-15')).toBe(new Date(2024, 5, 15).getTime());
    expect(dayEnd('2024-06-15')).toBe(new Date(2024, 5, 16).getTime() - 1);
    expect(fromCoreFilters({ updatedFrom: new Date(2024, 5, 15).getTime() }).updatedFrom).toBe(
      '2024-06-15',
    );
  });

  it('fromCoreFilters keeps every tag and folder id, and tolerates unknown keys', () => {
    const f = fromCoreFilters({
      tagIds: ['a', 'b', 'c'],
      folderIds: ['x', 'y'],
      favorite: true,
      future: 1,
    } as never);
    expect(f.tagIds).toEqual(['a', 'b', 'c']);
    expect(f.folderIds).toEqual(['x', 'y']);
    expect(toCoreFilters(f)).toEqual({ favorite: true, tagIds: ['a', 'b', 'c'], folderIds: ['x', 'y'] });
  });

  it('widgets send favorite, tag, date, sort and direction params; results are filtered by core', async () => {
    env = makeEnv();
    const [a, c] = await seed(env, 'kiwi alpha', 'kiwi charlie', 'kiwi bravo');
    await env.bridge.rpc('notes.setFavorite', { id: a, favorite: true });
    const tag = (await env.bridge.rpc('tags.create', { name: 'fruit' })).ok
      ? ((await env.bridge.rpc('tags.list')) as { ok: true; value: { id: string }[] }).value[0]!.id
      : '';
    await env.bridge.rpc('tags.tagNote', { noteId: c, tagId: tag });
    b = await bootApp(env);
    await search(b, 'kiwi');
    expect(titles()).toHaveLength(3);

    await click(field('Favorites only'));
    await advance(b, 150);
    await waitFor(() => rows().length === 1, 'favorites only');
    expect(lastRun(env)['filters']).toEqual({ favorite: true });
    expect(titles()).toEqual(['kiwi alpha']);
    await click(field('Favorites only'));

    await choose(field('Tag'), tag);
    await advance(b, 150);
    await waitFor(() => rows().length === 1 && titles()[0] === 'kiwi charlie', 'tag filter');
    expect(lastRun(env)['filters']).toEqual({ tagIds: [tag] });
    await choose(field('Tag'), '');

    await choose(field('Created from'), '2024-01-05');
    await choose(field('Created to'), '2024-01-06');
    await choose(field('Updated from'), '2024-03-01');
    await choose(field('Updated to'), '2024-03-02');
    await advance(b, 150);
    await waitFor(() => b!.model().search.get().status !== 'loading', 'dates');
    expect(lastRun(env)['filters']).toEqual({
      createdFrom: new Date(2024, 0, 5).getTime(),
      createdTo: new Date(2024, 0, 7).getTime() - 1,
      updatedFrom: new Date(2024, 2, 1).getTime(),
      updatedTo: new Date(2024, 2, 3).getTime() - 1,
    });
    expect(rows()).toHaveLength(0);
    await click(byText(document.body, 'Clear filters'));
    await advance(b, 150);
    await waitFor(() => rows().length === 3, 'cleared');
    expect(lastRun(env)['filters']).toBeUndefined();

    expect(field('Order').disabled).toBe(true); // relevance has no direction
    await choose(field('Sort by'), 'title');
    await advance(b, 150);
    await waitFor(() => rows().length === 3 && titles()[0] === 'kiwi charlie', 'title desc');
    expect(lastRun(env)).toMatchObject({ sort: 'title', dir: 'desc' });
    expect(titles()).toEqual(['kiwi charlie', 'kiwi bravo', 'kiwi alpha']);
    await choose(field('Order'), 'asc');
    await advance(b, 150);
    await waitFor(() => titles()[0] === 'kiwi alpha', 'title asc');
    expect(lastRun(env)).toMatchObject({ sort: 'title', dir: 'asc' });
  });

  it('an inclusive end-of-day bound keeps notes created today', async () => {
    env = makeEnv();
    await seed(env, 'kiwi today');
    b = await bootApp(env);
    await search(b, 'kiwi');
    const n = new Date(); // the user's local day, not the UTC one
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    await choose(field('Created from'), today);
    await choose(field('Created to'), today);
    await advance(b, 150);
    await waitFor(() => b!.model().search.get().status === 'ready', 'today');
    expect(rows()).toHaveLength(1);
    await choose(field('Created to'), '2001-01-01');
    await advance(b, 150);
    await waitFor(() => rows().length === 0, 'excluded');
  });
});

describe('saved searches (SR-7)', () => {
  const savedButtons = () => [
    ...document.querySelectorAll<HTMLElement>(
      'ul[aria-label="Saved searches list"] li > button:first-child',
    ),
  ];
  async function saveCurrent(name: string) {
    await click(byText(document.body, 'Save search'));
    const input = dialog()!.querySelector<HTMLInputElement>('input')!;
    await typeInto(input, name);
    await click(byText(dialog()!, 'Save'));
    await waitFor(() => !dialog(), 'dialog closed');
  }

  it('create, apply (restores query, scope, filters, sort), rename, delete, and survive a restart', async () => {
    env = makeEnv();
    const f = await env.bridge.rpc('folders.create', { name: 'Work' });
    const folderId = (f as { ok: true; value: { id: string } }).value.id;
    await env.bridge.rpc('notes.create', { body: 'kiwi inside', folderId });
    await seed(env, 'kiwi outside');
    b = await bootApp(env, { ready: () => !!treeItem('Work') });
    await click(treeItem('Work'));
    await search(b, 'kiwi');
    await click(field('Favorites only'));
    await choose(field('Sort by'), 'title');
    await choose(field('Order'), 'asc');
    await choose(field('Created from'), '2020-02-03');
    await saveCurrent('Kiwi in Work');
    await waitFor(() => savedButtons().length === 1, 'saved listed');
    expect(savedButtons()[0]!.textContent).toBe('Kiwi in Work');

    // Restart: the list comes back from the store; applying restores everything.
    await b.m.unmount();
    env = env.restart();
    b = await bootApp(env, { ready: () => !!treeItem('Work') });
    await waitFor(() => savedButtons().length === 1, 'saved after restart');
    expect(box().value).toBe('');
    await click(savedButtons()[0]!);
    await waitFor(() => b!.model().search.get().status !== 'loading', 'applied');
    expect(box().value).toBe('kiwi');
    expect(field('Favorites only').checked).toBe(true);
    expect(field('Sort by').value).toBe('title');
    expect(field('Order').value).toBe('asc');
    expect(field('Created from').value).toBe('2020-02-03');
    expect(b.model().nav.get()).toEqual({ kind: 'folder', id: folderId });
    expect(lastRun(env)).toMatchObject({
      query: 'kiwi',
      scope: { kind: 'folder', id: folderId },
      sort: 'title',
      dir: 'asc',
      filters: { favorite: true, createdFrom: new Date(2020, 1, 3).getTime() },
    });

    await click(document.querySelector('[aria-label="Rename saved search Kiwi in Work"]'));
    const input = dialog()!.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('Kiwi in Work');
    await typeInto(input, 'Renamed');
    await click(byText(dialog()!, 'Save'));
    await waitFor(() => savedButtons()[0]?.textContent === 'Renamed', 'renamed');

    await click(document.querySelector('[aria-label="Delete saved search Renamed"]'));
    expect(dialog()!.getAttribute('role')).toBe('alertdialog');
    expect(savedButtons()).toHaveLength(1); // not deleted until confirmed
    await click(byText(dialog()!, 'Cancel'));
    expect(savedButtons()).toHaveLength(1);
    await click(document.querySelector('[aria-label="Delete saved search Renamed"]'));
    await click(byText(dialog()!, 'Delete saved search'));
    await waitFor(() => savedButtons().length === 0, 'deleted');
    expect(text()).toContain('None yet');
  });

  it('rejects an empty name in the dialog and shows the core error', async () => {
    env = makeEnv();
    await seed(env, 'kiwi');
    b = await bootApp(env);
    await search(b, 'kiwi');
    await click(byText(document.body, 'Save search'));
    const input = dialog()!.querySelector<HTMLInputElement>('input')!;
    await typeInto(input, '   ');
    await click(byText(dialog()!, 'Save'));
    expect(dialog()!.querySelector('[role=alert]')!.textContent).toBe(
      'A saved search needs a name.',
    );
    expect(env.bridge.count('search.saved.create')).toBe(0);
  });

  it('a corrupt store shows the error and Reset (confirmed); the raw value is kept aside', async () => {
    env = makeEnv();
    sql(env).prepare("INSERT INTO meta(key, value) VALUES ('saved_searches', ?)").run('{not json');
    b = await bootApp(env);
    await waitFor(() => /could not be read/.test(text()), 'corrupt message');
    const section = document.querySelector('[aria-label="Saved searches"]')!;
    expect(section.querySelector('[role=alert]')).not.toBeNull();
    await click(byText(section, 'Reset saved searches'));
    expect(dialog()!.getAttribute('role')).toBe('alertdialog');
    expect(env.bridge.count('search.saved.reset')).toBe(0); // asks first
    await click(byText(dialog()!, 'Reset saved searches'));
    await waitFor(() => /None yet/.test(text()), 'reset done');
    expect(section.querySelector('[role=alert]')).toBeNull();
    const kept = sql(env)
      .prepare("SELECT value FROM meta WHERE key = 'saved_searches_damaged'")
      .get() as {
      value: string;
    };
    expect(kept.value).toBe('{not json');
  });
});

describe('refresh rules (M8)', () => {
  function bulk(e: Env, n: number, word: string) {
    const db = sql(e);
    const ins = db.prepare(
      'INSERT INTO notes(id, folder_id, title, body, content_hash, rev, favorite, created_at, updated_at, device_id) VALUES (?,NULL,?,?,?,1,0,?,?,?)',
    );
    db.exec('BEGIN');
    for (let i = 0; i < n; i++) {
      const t = `${word} ${String(i).padStart(5, '0')}`;
      ins.run(`01HF7YAT00${String(i).padStart(16, '0')}`, t, t, `h${i}`, i + 1, i + 1, 'D');
    }
    db.exec('COMMIT');
  }

  it('own-save changed events (content) never re-run the search; structural ones do and keep the loaded page count', async () => {
    env = makeEnv();
    bulk(env, 130, 'tapir');
    b = await bootApp(env, { ready: () => true });
    await search(b, 'tapir');
    expect(rows()).toHaveLength(50);
    await click(byText(document.body, 'Load more'));
    await waitFor(() => rows().length === 100, 'second page');
    await click(byText(document.body, 'Load more'));
    await waitFor(() => rows().length === 130, 'third page');
    expect(byText(document.body, 'Load more')).toBeUndefined();

    const n = runCalls(env).length;
    env.bridge.emit({ type: 'changed', entity: 'note', ids: ['x'], content: true });
    await advance(b, 500);
    expect(runCalls(env).length).toBe(n); // no re-run for an autosave

    env.bridge.emit({ type: 'changed', entity: 'note', ids: ['x'] });
    await advance(b, 150);
    await waitFor(() => runCalls(env!).length > n, 'structural refetch');
    await waitFor(() => b!.model().search.get().status === 'ready', 'refetch settled');
    expect(rows()).toHaveLength(130); // not reset to the first page
  });

  it('a hit that disappears does not break the list or drop focus', async () => {
    env = makeEnv();
    const ids = await seed(env, 'okapi one', 'okapi two', 'okapi three');
    b = await bootApp(env);
    await search(b, 'okapi');
    await press(box(), 'ArrowDown');
    await press(document.activeElement!, 'ArrowDown');
    const focused = (document.activeElement as HTMLElement).dataset['id']!;
    expect(ids).toContain(focused);
    await env.bridge.rpc('notes.trash', { id: focused }); // emits a structural changed event
    await advance(b, 150);
    await waitFor(() => rows().length === 2, 'row gone');
    await settle(10);
    expect(rows().some((r) => r.dataset['id'] === focused)).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(rows().filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(status()).toBe('2 results');
  });
});

describe('Check search index (command)', () => {
  const runCommand = async (id: string) => {
    env!.bridge.emit({ type: 'command', id });
    await settle(30);
  };
  it('reports ok, failed and error as toasts', async () => {
    env = makeEnv();
    b = await bootApp(env);
    await runCommand('search.verify');
    await waitFor(() => /search index is healthy/.test(text()), 'ok toast');
    expect(env.bridge.count('search.verify')).toBe(1);
    env.bridge.inject('search.verify', { ok: true, value: { ok: false } });
    await runCommand('search.verify');
    await waitFor(() => /had problems/.test(text()), 'problem toast');
    env.bridge.inject('search.verify', { ok: false, error: { code: 'internal', message: 'boom' } });
    await runCommand('search.verify');
    await waitFor(() => /Couldn’t check the search index: boom/.test(text()), 'error toast');
  });
  it('skipped (index is rebuilding) says so instead of reporting a verdict', async () => {
    env = makeEnv();
    b = await bootApp(env);
    env.bridge.inject('search.verify', { ok: true, value: { ok: true, skipped: true } });
    await runCommand('search.verify');
    await waitFor(() => /Index is rebuilding; try again when it finishes/.test(text()), 'skip toast');
    expect(text()).not.toContain('search index is healthy');
  });
  it('is listed in the command palette with Search notes', async () => {
    env = makeEnv();
    b = await bootApp(env);
    await press(document.body, 'k', { ctrlKey: true });
    await waitFor(() => !!document.querySelector('input[role=combobox]'), 'palette');
    const input = document.querySelector<HTMLInputElement>('input[role=combobox]')!;
    await typeInto(input, 'search');
    const labels = [...document.querySelectorAll('#mn-pal-list [role=option]')].map(
      (o) => o.textContent,
    );
    expect(labels.some((l) => l?.startsWith('Search notes'))).toBe(true);
    expect(labels).toContain('Check search index');
    expect(labels).toContain('Rebuild search index');
  });
});

describe('10k hits (SR-3 UI part)', () => {
  it('renders a page of 50, caps the DOM at the row limit and stays inside a time budget', async () => {
    env = makeEnv();
    const db = sql(env);
    const ins = db.prepare(
      'INSERT INTO notes(id, folder_id, title, body, content_hash, rev, favorite, created_at, updated_at, device_id) VALUES (?,NULL,?,?,?,1,0,?,?,?)',
    );
    db.exec('BEGIN');
    for (let i = 0; i < 10_000; i++) {
      const t = `common note ${i}`;
      ins.run(
        `01HF7YAT00${String(i).padStart(16, '0')}`,
        t,
        `${t} body words`,
        `h${i}`,
        i + 1,
        i + 1,
        'D',
      );
    }
    db.exec('COMMIT');
    b = await bootApp(env, { ready: () => true });
    const t0 = performance.now();
    await search(b, 'common');
    const first = performance.now() - t0;
    expect(rows()).toHaveLength(50);
    expect(document.querySelectorAll('.search-results *').length).toBeLessThan(1000);
    expect(first).toBeLessThan(5000);

    let clicks = 0;
    const t1 = performance.now();
    while (byText(document.body, 'Load more') && clicks < 40) {
      const want = Math.min(MAX_ROWS, rows().length + 50);
      await click(byText(document.body, 'Load more'));
      await waitFor(() => rows().length === want, `page ${clicks + 2}`);
      clicks++;
    }
    expect(rows()).toHaveLength(MAX_ROWS);
    expect(byText(document.body, 'Load more')).toBeUndefined(); // capped
    expect(text()).toContain(`Showing the first ${MAX_ROWS} results`);
    expect(performance.now() - t1).toBeLessThan(30_000);
  }, 60_000);
});

describe('index error state and Rebuild search index (MAJOR 2, MAJOR 5 UI)', () => {
  const alertText = () => document.querySelector('.search-results [role=alert]')?.textContent ?? '';
  const errorPage = (message: string) => ({
    ok: true as const,
    value: { state: 'error' as const, hits: [], messages: [message] },
  });

  it('an error page shows the message verbatim as text, never as markup; Retry calls search.rebuild and recovers', async () => {
    env = makeEnv();
    await seed(env, 'moss');
    b = await bootApp(env);
    const hostile = 'disk <img src=x onerror=alert(1)> & <b>bold</b> failed';
    env.bridge.inject('search.run', errorPage(hostile));
    await search(b, 'moss', () => alertText() !== '');
    expect(alertText()).toContain(hostile);
    expect(document.querySelector('.search-results img, .search-results b')).toBeNull();
    expect(document.querySelector('.search-index-error')!.textContent).toBe(hostile);
    expect(text()).not.toContain('Rebuilding the search index…');
    expect(rows()).toHaveLength(0);
    expect(b.model().search.get().status).toBe('indexError');
    // the live-region policy: a polite status line plus the assertive alert, like the search-failed state
    expect(status()).toBe(`Search index error: ${hostile}`);
    expect(document.querySelector('[role=status].search-status')!.getAttribute('aria-live') ?? 'polite').toBe('polite');
    expect(document.querySelector('.search-results [role=alert]')!.getAttribute('aria-live') ?? 'assertive').toBe('assertive');

    expect(env.bridge.count('search.rebuild')).toBe(0);
    await click(byText(document.querySelector('.search-results')!, 'Retry'));
    await waitFor(() => rows().length === 1, 'results after rebuild');
    expect(env.bridge.count('search.rebuild')).toBe(1);
    expect(alertText()).toBe('');
    expect(b.model().search.get().index.state).toBe('ready');
  });

  it('a searchState error event replaces the results; a later rebuilding then ready restores them', async () => {
    env = makeEnv();
    await seed(env, 'moss');
    b = await bootApp(env);
    await search(b, 'moss');
    expect(rows()).toHaveLength(1);
    env.bridge.emit({ type: 'searchState', state: 'error', message: 'rebuild failed twice' });
    await waitFor(() => alertText().includes('rebuild failed twice'), 'error shown');
    expect(rows()).toHaveLength(0);
    expect(b.model().search.get().index).toEqual({ state: 'error', message: 'rebuild failed twice' });
    env.bridge.emit({ type: 'searchState', state: 'rebuilding', progress: { done: 1, total: 2 } });
    await waitFor(() => /Rebuilding the search index… 1 of 2 notes/.test(text()), 'progress');
    expect(alertText()).toBe('');
    env.bridge.emit({ type: 'searchState', state: 'ready' });
    await waitFor(() => rows().length === 1, 'results back');
  });

  it('an error event without a query only records the state; the pane is not touched', async () => {
    env = makeEnv();
    b = await bootApp(env);
    env.bridge.emit({ type: 'searchState', state: 'error', message: 'nope' });
    expect(b.model().search.get().index).toEqual({ state: 'error', message: 'nope' });
    expect(b.model().search.get().status).toBe('idle');
    expect(document.querySelector('[role=alert]')).toBeNull();
  });

  it('never stays on "Rebuilding…": a rebuilding page whose status poll says error ends in the error view', async () => {
    env = makeEnv();
    await seed(env, 'moss');
    b = await bootApp(env);
    env.bridge.inject('search.run', {
      ok: true,
      value: { state: 'rebuilding', progress: { done: 0, total: 1 }, hits: [], messages: [] },
    });
    env.bridge.inject('search.status', { ok: true, value: { state: 'error', message: 'gave up' } });
    await search(b, 'moss', () => alertText() !== '');
    expect(alertText()).toContain('gave up');
    expect(text()).not.toContain('Rebuilding the search index…');
  });

  it('search.status error at load is kept as the index state', async () => {
    env = makeEnv();
    env.bridge.inject('search.status', { ok: true, value: { state: 'error', message: 'old failure' } });
    b = await bootApp(env);
    await waitFor(() => b!.model().search.get().index.state === 'error', 'status error');
  });

  it('the palette command search.rebuild calls search.rebuild and toasts; it has no shortcut', async () => {
    env = makeEnv();
    b = await bootApp(env);
    const spec = commands.find((c) => c.id === 'search.rebuild')!;
    expect(spec.title).toBe('Rebuild search index');
    expect(spec).not.toHaveProperty('shortcut');
    env.bridge.emit({ type: 'command', id: 'search.rebuild' });
    await settle(30);
    await waitFor(() => env!.bridge.count('search.rebuild') === 1, 'rebuild called');
    await waitFor(() => /Rebuilding the search index…/.test(text()), 'toast');
  });

  it('a failed rebuild call is reported', async () => {
    env = makeEnv();
    b = await bootApp(env);
    env.bridge.inject('search.rebuild', { ok: false, error: { code: 'internal', message: 'busy' } });
    env.bridge.emit({ type: 'command', id: 'search.rebuild' });
    await settle(30);
    await waitFor(() => /Couldn’t rebuild the search index: busy/.test(text()), 'error toast');
  });
});

describe('saved searches with several tags and folders, and unknown keys', () => {
  const idOf = async (name: string) =>
    (
      (await env!.bridge.rpc('tags.create', { name })) as { ok: true; value: { id: string } }
    ).value.id;

  it('applies ALL tag and folder ids (chips), sends them all, removing one chip narrows only by the user', async () => {
    env = makeEnv();
    await seed(env, 'kiwi');
    const [t1, t2] = [await idOf('alpha'), await idOf('beta')];
    const folder = (
      (await env.bridge.rpc('folders.create', { name: 'Work' })) as { ok: true; value: { id: string } }
    ).value.id;
    sql(env)
      .prepare("INSERT INTO meta(key, value) VALUES ('saved_searches', ?)")
      .run(
        JSON.stringify([
          {
            id: 'S1',
            name: 'Raw',
            spec: {
              query: 'kiwi',
              filters: { tagIds: [t1, t2], folderIds: [folder], favoriteX: 1 },
              futureSpecKey: { a: 1 },
            },
            createdAt: 1,
            updatedAt: 1,
            futureEntryKey: true,
          },
        ]),
      );
    b = await bootApp(env, { ready: () => !!treeItem('Work') });
    await waitFor(() => !!byText(document.body, 'Raw'), 'entry listed despite unknown keys');
    await click(byText(document.body, 'Raw'));
    await waitFor(() => b!.model().search.get().status !== 'loading', 'applied');
    expect(lastRun(env)['filters']).toEqual({ tagIds: [t1, t2], folderIds: [folder] });
    expect(b.model().search.get().filters.tagIds).toEqual([t1, t2]);
    const chips = [...document.querySelectorAll('[aria-label="Applied filters"] li')].map((l) =>
      l.textContent,
    );
    expect(chips).toEqual(['Tag alpha×', 'Tag beta×', 'Folder Work×']);

    await click(document.querySelector('[aria-label="Remove folder filter Work"]'));
    await click(document.querySelector('[aria-label="Remove tag filter beta"]'));
    await advance(b, 150);
    await waitFor(() => b!.model().search.get().status !== 'loading', 'narrowed by the user');
    expect(lastRun(env)['filters']).toEqual({ tagIds: [t1] });
    expect(field('Tag').value).toBe(t1);
  });

  it('renaming keeps unknown keys of the stored entry, its spec and its filters', async () => {
    env = makeEnv();
    const stored = {
      id: 'S1',
      name: 'Raw',
      spec: { query: 'kiwi', filters: { tagIds: ['x'], futureFilter: 2 }, futureSpecKey: [1] },
      createdAt: 1,
      updatedAt: 1,
      futureEntryKey: 'k',
    };
    sql(env)
      .prepare("INSERT INTO meta(key, value) VALUES ('saved_searches', ?)")
      .run(JSON.stringify([stored]));
    b = await bootApp(env);
    await waitFor(() => !!byText(document.body, 'Raw'), 'listed');
    await click(document.querySelector('[aria-label="Rename saved search Raw"]'));
    await typeInto(dialog()!.querySelector<HTMLInputElement>('input')!, 'Cooked');
    await click(byText(dialog()!, 'Save'));
    await waitFor(() => !!byText(document.body, 'Cooked'), 'renamed');
    const raw = sql(env).prepare("SELECT value FROM meta WHERE key = 'saved_searches'").get() as {
      value: string;
    };
    const after = (JSON.parse(raw.value) as (typeof stored)[])[0]!;
    expect(after.name).toBe('Cooked');
    expect(after.spec).toEqual(stored.spec);
    expect(after.futureEntryKey).toBe('k');
  });
});
