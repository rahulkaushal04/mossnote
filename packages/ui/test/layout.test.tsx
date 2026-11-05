// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { clampSizes, EDITOR_MIN, LIST, NAV, SPLITTER_W } from '../src/layout/sizes';
import { fakeEditorFactory, mount, press, settle, waitFor, type Mounted } from './helpers/dom';
import { manualTimers } from './helpers/timers';
import { makeEnv, type Env } from './helpers/workspace';

describe('clampSizes', () => {
  const s = { nav: 240, list: 320, navCollapsed: false };
  it('keeps sizes that fit', () => {
    expect(clampSizes(s, 1400)).toEqual({ nav: 240, list: 320, navHidden: false });
  });
  it('limits each pane to its range', () => {
    expect(clampSizes({ ...s, nav: 50, list: 9999 }, 3000)).toMatchObject({
      nav: NAV.min,
      list: LIST.max,
    });
    expect(clampSizes({ ...s, nav: 9999, list: 10 }, 3000)).toMatchObject({
      nav: NAV.max,
      list: LIST.min,
    });
  });
  it('shrinks the list first, then the nav, and never gives the editor less than its minimum', () => {
    for (let w = 600; w <= 1600; w += 25) {
      const e = clampSizes(s, w);
      const used = (e.navHidden ? 0 : e.nav + SPLITTER_W) + e.list + SPLITTER_W;
      if (w >= NAV.min + LIST.min + EDITOR_MIN + 2 * SPLITTER_W) {
        expect(w - used).toBeGreaterThanOrEqual(EDITOR_MIN);
        expect(e.navHidden).toBe(false);
      }
    }
    const tight = clampSizes(s, 240 + 200 + EDITOR_MIN + 2 * SPLITTER_W);
    expect(tight.list).toBe(LIST.min); // list gave way before the nav
    expect(tight.nav).toBe(240);
    const tighter = clampSizes(s, NAV.min + LIST.min + EDITOR_MIN + 2 * SPLITTER_W);
    expect(tighter).toMatchObject({ nav: NAV.min, list: LIST.min, navHidden: false });
  });
  it('hides the nav when even the minimums do not fit, and does not mutate the preference', () => {
    const e = clampSizes(s, 500);
    expect(e.navHidden).toBe(true);
    expect(s).toEqual({ nav: 240, list: 320, navCollapsed: false });
  });
  it('honours the user collapse', () => {
    expect(clampSizes({ ...s, navCollapsed: true }, 2000).navHidden).toBe(true);
  });
});

describe('splitters in the shell', () => {
  let env: Env | undefined;
  let m: Mounted | undefined;
  afterEach(async () => {
    await m?.unmount();
    env?.cleanup();
    m = env = undefined;
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  });

  async function boot(e: Env, timers = manualTimers()) {
    const fake = fakeEditorFactory();
    m = await mount(<App bridge={e.bridge} timers={timers} createEditor={fake.factory} />);
    await waitFor(() => m!.el.querySelector('[role=separator]') !== null, 'shell');
    return timers;
  }
  const seps = () => [...document.querySelectorAll<HTMLElement>('[role=separator]')];
  const num = (e: Element, a: string) => Number(e.getAttribute(a));

  it('renders the landmarks', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
    env = makeEnv();
    await boot(env);
    const q = (s: string) => document.querySelector(s);
    expect(q('nav[aria-label="Folders and tags"]')).not.toBeNull();
    expect(q('section[aria-label="Notes"]')).not.toBeNull();
    expect(q('main')).not.toBeNull();
    expect(q('footer')?.textContent).toContain('Sync: Not paired');
  });

  it('keys change aria-valuenow: arrows, Shift, Home, End, clamped to the range', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
    env = makeEnv();
    await boot(env);
    const nav = seps()[0]!;
    expect(num(nav, 'aria-valuenow')).toBe(240);
    await press(nav, 'ArrowRight');
    expect(num(nav, 'aria-valuenow')).toBe(256);
    await press(nav, 'ArrowLeft', { shiftKey: true });
    expect(num(nav, 'aria-valuenow')).toBe(192);
    await press(nav, 'Home');
    expect(num(nav, 'aria-valuenow')).toBe(NAV.min);
    await press(nav, 'ArrowLeft');
    expect(num(nav, 'aria-valuenow')).toBe(NAV.min); // clamped
    await press(nav, 'End');
    expect(num(nav, 'aria-valuenow')).toBe(NAV.max);
    expect(num(nav, 'aria-valuemin')).toBe(NAV.min);
    const grid = document.querySelector<HTMLElement>('.shell')!;
    expect(grid.style.gridTemplateColumns.startsWith(`${NAV.max}px`)).toBe(true);
    const list = seps()[1]!;
    await press(list, 'ArrowRight', { shiftKey: true });
    expect(num(list, 'aria-valuenow')).toBe(320 + 64);
  });

  it('Enter collapses and expands the sidebar (hidden = out of the tab order)', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
    env = makeEnv();
    await boot(env);
    const nav = document.querySelector<HTMLElement>('nav')!;
    expect(nav.hidden).toBe(false);
    await press(seps()[0]!, 'Enter');
    expect(nav.hidden).toBe(true);
    await press(seps()[0]!, 'Enter');
    expect(nav.hidden).toBe(false);
  });

  it('the pointer drag captures the pointer and resizes', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
    env = makeEnv();
    await boot(env);
    const nav = seps()[0]!;
    const captured: number[] = [];
    (nav as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = (id) =>
      void captured.push(id);
    const ev = (type: string, x: number) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x });
      Object.defineProperty(e, 'pointerId', { value: 7 });
      return e;
    };
    await act(async () => void nav.dispatchEvent(ev('pointerdown', 100)));
    await act(async () => void nav.dispatchEvent(ev('pointermove', 150)));
    expect(num(nav, 'aria-valuenow')).toBe(290);
    await act(async () => void nav.dispatchEvent(ev('pointerup', 150)));
    await act(async () => void nav.dispatchEvent(ev('pointermove', 400)));
    expect(captured).toEqual([7]);
    expect(num(nav, 'aria-valuenow')).toBe(290); // no drag after release
  });

  it('shrinking the window clamps the display but not the saved preference', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
    env = makeEnv();
    const timers = await boot(env);
    await press(seps()[1]!, 'End');
    const wide = num(seps()[1]!, 'aria-valuenow');
    expect(wide).toBe(LIST.max);
    await act(async () => {
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(num(seps()[1]!, 'aria-valuenow')).toBeLessThan(wide);
    await act(async () => void (await timers.advance(300)));
    const p = await env.bridge.rpc('prefs.get', {});
    expect(p).toMatchObject({ ok: true, value: { listWidth: LIST.max } });
  });

  it('persists through prefs.set debounced 300 ms and is restored after a simulated restart', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
    env = makeEnv();
    const timers = await boot(env);
    await press(seps()[0]!, 'ArrowRight');
    await press(seps()[0]!, 'ArrowRight');
    await press(seps()[1]!, 'ArrowLeft', { shiftKey: true });
    await act(async () => void (await timers.advance(299)));
    expect(env.bridge.count('prefs.set')).toBe(0);
    await act(async () => void (await timers.advance(1)));
    expect(env.bridge.count('prefs.set')).toBe(1); // three changes, one write
    expect(env.bridge.calls.find((c) => c.method === 'prefs.set')?.args).toEqual({
      navWidth: 272,
      listWidth: 256,
      navCollapsed: false,
    });

    await press(seps()[0]!, 'Enter');
    await act(async () => void (await timers.advance(300)));
    await m!.unmount();
    env = env.restart(); // flush, close, reopen the same directory
    await boot(env);
    expect(num(seps()[0]!, 'aria-valuenow')).toBe(272);
    expect(num(seps()[1]!, 'aria-valuenow')).toBe(256);
    expect(document.querySelector<HTMLElement>('nav')!.hidden).toBe(true); // collapse restored too
    await settle();
  });
});
