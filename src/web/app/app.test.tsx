// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode, fromDayNumber } from '@shared/gameDate';
import { api, ApiError, NetworkError } from '../lib/api';
import { mockApi, renderApp, settingsFixture, stardewFixture } from '../testing';
import { resetViewportAfterEach, setViewport } from '../testViewport';

resetViewportAfterEach();
beforeEach(() => {
  localStorage.clear();
  mockApi();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('empty app shell', () => {
  it('shows Today with the quiet empty copy when no date is set', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeTruthy();
    expect(await screen.findByText('Nothing written today.')).toBeTruthy();
    expect(document.title).toBe('Today · Mossnote');
  });

  it('uses the quiet-day copy once a current date is set', async () => {
    mockApi(settingsFixture({ currentGameDate: encode({ year: 1, season: 0, day: 3 }) }));
    renderApp('/');
    expect(
      await screen.findByText('Nothing written for this day. A quiet day is fine.'),
    ).toBeTruthy();
  });

  it('has the landmarks and the four destinations of the Default template, with the current one marked', async () => {
    renderApp('/journal');
    await screen.findByRole('heading', { level: 1, name: 'Journal' });
    expect(screen.getByRole('main')).toBeTruthy();
    const nav = screen.getAllByRole('navigation', { name: 'Primary' }).at(0);
    if (!nav) throw new Error('No primary navigation.');
    const labels = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(labels).toEqual(['Today', 'Journal', 'People', 'Maps', 'Settings']);
    const current = screen.getAllByRole('link', { current: 'page' }).map((a) => a.textContent);
    expect(current).toContain('Journal');
    expect(current).not.toContain('Today');
  });

  it('offers a skip link to the main content', async () => {
    renderApp('/');
    await screen.findByRole('main');
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip.getAttribute('href')).toBe('#main');
    expect(document.getElementById('main')).toBeTruthy();
  });

  it('shows the empty-state copy on each destination', async () => {
    const copy: [string, string][] = [
      ['/journal', 'Your journal starts with your first note.'],
      ['/people', 'No people yet. Add someone above, or type @ in a note.'],
    ];
    for (const [path, text] of copy) {
      const view = renderApp(path);
      expect(await screen.findByText(text), path).toBeTruthy();
      view.unmount();
    }
  });

  it('every route has exactly one h1 and a route-specific document title', async () => {
    const pages: [string, string][] = [
      ['/', 'Today'],
      ['/journal', 'Journal'],
      ['/people', 'People'],
      ['/settings', 'Settings'],
      ['/search', 'Search'],
      ['/notes/abc', 'Note'],
      ['/people/abc', 'Person'],
      ['/nowhere', 'Not found'],
    ];
    for (const [path, title] of pages) {
      const view = renderApp(path);
      await screen.findByRole('heading', { level: 1, name: title });
      expect(screen.getAllByRole('heading', { level: 1 }), path).toHaveLength(1);
      await waitFor(() => {
        expect(document.title, path).toBe(`${title} · Mossnote`);
      });
      view.unmount();
    }
  });

  it('has no Farm screens at all in a Default journal', async () => {
    renderApp('/farm');
    await screen.findByRole('heading', { level: 1, name: 'Not found' });
    cleanup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(screen.queryByRole('link', { name: /farm/i })).toBeNull();
    expect(screen.queryByText(/Growing/)).toBeNull();
  });

  it('a Stardew Valley journal has the Farm screens and its own wording', async () => {
    mockApi(stardewFixture());
    renderApp('/farm');
    expect(await screen.findByRole('heading', { level: 1, name: 'Farm' })).toBeTruthy();
    expect(
      await screen.findByText('Nothing here yet. Add a crop when you plant something.'),
    ).toBeTruthy();
    cleanup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    const nav = screen.getAllByRole('navigation', { name: 'Primary' }).at(0);
    if (!nav) throw new Error('No primary navigation.');
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Today', 'Daily journal', 'NPCs', 'Farm', 'Maps', 'Settings']);
  });

  it('/farm/:id is a sheet over the list, as a labelled modal dialog', async () => {
    mockApi(stardewFixture());
    renderApp('/farm/abc');
    expect(await screen.findByRole('dialog', { name: 'Crop' })).toBeTruthy();
    // The list stays in the document, behind the sheet (hidden from assistive technology).
    expect(screen.getByRole('heading', { level: 1, name: 'Farm', hidden: true })).toBeTruthy();
  });

  it('copy rule: no exclamation marks on any screen', async () => {
    for (const path of ['/', '/journal', '/people', '/settings', '/nowhere', '/day/zzz']) {
      const view = renderApp(path);
      await screen.findByRole('main');
      await waitFor(() => {
        expect(document.body.textContent).toBeTruthy();
      });
      expect(document.body.textContent, path).not.toContain('!');
      view.unmount();
    }
  });
});

describe('routes', () => {
  it('redirects /tags/:name to the journal filter', async () => {
    const { router } = renderApp('/tags/idea');
    await screen.findByRole('heading', { level: 1, name: 'Journal' });
    expect(router.state.location.pathname).toBe('/journal');
    expect(router.state.location.search).toBe('?tag=idea');
  });

  it('encodes tag names in the redirect', async () => {
    const { router } = renderApp('/tags/a%20b%26c');
    await screen.findByRole('heading', { level: 1, name: 'Journal' });
    expect(new URLSearchParams(router.state.location.search).get('tag')).toBe('a b&c');
  });

  it('shows a calm 404 with a link to Today', async () => {
    renderApp('/no/such/page');
    await screen.findByRole('heading', { level: 1, name: 'Not found' });
    expect(screen.getByRole('link', { name: 'Go to Today' }).getAttribute('href')).toBe('/');
  });

  it('formats a valid day key with the user calendar', async () => {
    mockApi(stardewFixture());
    renderApp(`/day/${encode({ year: 2, season: 3, day: 9 })}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Winter 9 · Year 2' }),
    ).toBeTruthy();
  });

  it('writes a day of a Default journal as a counted day', async () => {
    renderApp(`/day/${fromDayNumber(120)}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Day 120' })).toBeTruthy();
  });

  it('says an out-of-calendar day is not in the calendar and links to Today', async () => {
    mockApi(stardewFixture());
    for (const key of ['10029', '10400', 'abc', '0']) {
      const view = renderApp(`/day/${key}`);
      expect(await screen.findByText(/That date isn.t in your calendar/), key).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Go to Today' })).toBeTruthy();
      view.unmount();
    }
  });

  it('has no /dev/kit route in a production-like build', async () => {
    renderApp('/dev/kit');
    await screen.findByRole('heading', { level: 1, name: 'Not found' });
  });

  it('moves focus to the page heading on navigation, not on first load', async () => {
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
    await act(async () => {
      await router.navigate('/journal');
    });
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Journal' });
    await waitFor(() => {
      expect(document.activeElement).toBe(h1);
    });
  });
});

describe('phone navigation', () => {
  const tabBar = () => {
    const bar = screen.getAllByRole('navigation', { name: 'Primary' }).at(-1);
    if (!bar) throw new Error('No tab bar.');
    return bar;
  };

  it('has an icon and a label for each section, and a More tab instead of Settings', async () => {
    setViewport(375);
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    const links = within(tabBar()).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Today', 'Journal', 'People', 'Maps']);
    for (const link of links) expect(link.querySelector('svg'), link.textContent).not.toBeNull();
    expect(within(tabBar()).getByRole('button', { name: 'More' })).toBeTruthy();
    expect(within(tabBar()).queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('More opens a sheet with the journals and Settings, and closes when you go to Settings', async () => {
    setViewport(375);
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    await userEvent.click(within(tabBar()).getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    expect(within(sheet).getByText('My journal')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'New journal…' })).toBeTruthy();
    await userEvent.click(within(sheet).getByRole('link', { name: 'Settings' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings');
    });
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
  });

  it('the page header has Search and New note buttons and no Settings link', async () => {
    setViewport(375);
    renderApp('/');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Today' });
    const header = heading.closest('header');
    if (!header) throw new Error('No page header.');
    expect(within(header).getByRole('button', { name: /^Search/ })).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'New note' })).toBeTruthy();
    expect(within(header).queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('hides the tab bar while the on-screen keyboard is open, so it cannot cover the composer', async () => {
    setViewport(375);
    const viewport = Object.assign(new EventTarget(), { height: 812, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 812, configurable: true });
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(3);
    act(() => {
      viewport.height = 500;
      viewport.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => {
      expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(2);
    });
    act(() => {
      viewport.height = 812;
      viewport.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => {
      expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(3);
    });
    Reflect.deleteProperty(window, 'visualViewport');
  });

  it('names the open journal above the page title', async () => {
    setViewport(375);
    renderApp('/journal');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Journal' });
    const header = heading.closest('header')!;
    expect(await within(header).findByText('My journal')).toBeTruthy();
    // The switcher lives in the More sheet on a phone, so here the name is only a caption.
    expect(within(header).queryByRole('button', { name: /Switch journal/ })).toBeNull();
  });
});

describe('Settings, Appearance', () => {
  it('changes the theme immediately and stores it', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Appearance' });
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('moss:theme')).toBe('dark');
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('saves the reading size to the server, applies it, and caches it', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Appearance' });
    await userEvent.click(screen.getByRole('radio', { name: 'Large' }));
    expect(document.documentElement.getAttribute('data-reading')).toBe('large');
    await waitFor(() => {
      expect(api.patchSettings).toHaveBeenCalledWith({ prefs: { readingSize: 'large' } });
    });
    expect(JSON.parse(localStorage.getItem('moss:ui') ?? '{}')).toEqual({ readingSize: 'large' });
  });

  it('shows the chosen reading size at once, before the server answers', async () => {
    vi.spyOn(api, 'patchSettings').mockReturnValue(new Promise(() => undefined));
    renderApp('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Appearance' });
    await userEvent.click(screen.getByRole('radio', { name: 'Large' }));
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Large' }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Comfortable' }).checked).toBe(
      false,
    );
  });

  it('puts the reading size back when saving fails', async () => {
    vi.spyOn(api, 'patchSettings').mockRejectedValue(new Error('nope'));
    renderApp('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Appearance' });
    await userEvent.click(screen.getByRole('radio', { name: 'Large' }));
    await screen.findByText("Couldn't save that change. It was undone.");
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Comfortable' }).checked).toBe(true);
    expect(document.documentElement.getAttribute('data-reading')).toBe('comfortable');
  });

  it('both choices are labelled radio groups reachable by keyboard', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Appearance' });
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Reading size' })).toBeTruthy();
    expect(
      within(screen.getByRole('radiogroup', { name: 'Theme' })).getAllByRole('radio'),
    ).toHaveLength(3);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Reading size' })).getAllByRole('radio'),
    ).toHaveLength(2);
  });

  it('says the change was undone when saving fails', async () => {
    vi.spyOn(api, 'patchSettings').mockRejectedValue(new Error('nope'));
    renderApp('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Appearance' });
    await userEvent.click(screen.getByRole('radio', { name: 'Large' }));
    expect(await screen.findByText("Couldn't save that change. It was undone.")).toBeTruthy();
  });
});

describe('server unreachable', () => {
  it('shows the full-page message with the start command and Retry', async () => {
    vi.spyOn(api, 'getHealth').mockRejectedValue(new NetworkError());
    renderApp('/journal');
    expect(await screen.findByRole('heading', { name: "Can't reach your journal." })).toBeTruthy();
    expect(screen.getByText('mossnote')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('returns to the previous screen when Retry succeeds', async () => {
    const health = vi.spyOn(api, 'getHealth').mockRejectedValue(new NetworkError());
    renderApp('/journal');
    await screen.findByRole('heading', { name: "Can't reach your journal." });
    health.mockResolvedValue({ ok: true, version: 'test', schemaVersion: 4, journal: 'journal' });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Journal' })).toBeTruthy();
  });

  it('retries by itself every 5 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const health = vi.spyOn(api, 'getHealth').mockRejectedValue(new NetworkError());
    renderApp('/');
    await screen.findByRole('heading', { name: "Can't reach your journal." });
    const callsBefore = health.mock.calls.length;
    health.mockResolvedValue({ ok: true, version: 'test', schemaVersion: 4, journal: 'journal' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(health.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeTruthy();
  });

  it('shows the page when another request cannot reach the server', async () => {
    const { client } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    vi.spyOn(api, 'getHealth').mockRejectedValue(new NetworkError());
    vi.spyOn(api, 'getSettings').mockRejectedValue(new NetworkError());
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['settings'] });
    });
    expect(await screen.findByRole('heading', { name: "Can't reach your journal." })).toBeTruthy();
  });
});

describe('a phone or tablet that is no longer welcome', () => {
  it('is told it was unpaired, with the way back', async () => {
    vi.spyOn(api, 'getHealth').mockRejectedValue(
      new ApiError(401, { code: 'unauthorized', message: 'This device is not paired.' }),
    );
    renderApp('/');

    expect(
      await screen.findByRole('heading', { name: "This device isn't paired any more." }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pair this device' }).getAttribute('href')).toBe(
      '/pair',
    );
  });

  it('is told it cannot reach the journal when phone access was switched off', async () => {
    vi.spyOn(api, 'getHealth').mockRejectedValue(
      new ApiError(403, { code: 'forbidden', message: 'This request was refused.' }),
    );
    renderApp('/');

    expect(await screen.findByRole('heading', { name: "Can't reach your journal." })).toBeTruthy();
  });
});

describe('route error boundary', () => {
  it('shows a calm message with Reload and Copy details', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A server error (not a network error) while loading settings reaches the route boundary.
    vi.spyOn(api, 'getSettings').mockRejectedValue(
      new ApiError(500, { code: 'internal', message: 'Something went wrong. Reference abc.' }),
    );
    renderApp('/');
    expect(
      await screen.findByText('Something went wrong on this page.', {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    const copy = screen.getByRole('button', { name: 'Copy details' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(copy);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain('journal.db');
    error.mockRestore();
  });
});

describe('game template and sections', () => {
  const layout = {
    template: 'stardew',
    order: ['maps', 'today', 'journal', 'people', 'farm'] as const,
    hidden: ['farm'] as const,
    labels: { journal: 'Logbook' },
    quickActions: true,
  };
  const withLayout = () =>
    mockApi(
      stardewFixture({
        layout: { ...layout, order: [...layout.order], hidden: [...layout.hidden] },
      }),
    );

  it('names, orders and hides the navigation from the saved layout', async () => {
    withLayout();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    const nav = screen.getAllByRole('navigation', { name: 'Primary' }).at(0);
    if (!nav) throw new Error('No primary navigation.');
    await waitFor(() => {
      expect(
        within(nav)
          .getAllByRole('link')
          .map((a) => a.textContent),
      ).toEqual(['Maps', 'Today', 'Logbook', 'NPCs', 'Settings']);
    });
  });

  it('uses the template wording on a page and shows its quick actions in the composer', async () => {
    withLayout();
    renderApp('/people');
    expect(await screen.findByRole('heading', { level: 1, name: 'NPCs' })).toBeTruthy();
    cleanup();
    renderApp('/');
    const group = await screen.findByRole('group', { name: 'Quick actions' });
    const found = within(group).getByRole('button', { name: 'Found something' });
    expect(found.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(found);
    expect(found.getAttribute('aria-pressed')).toBe('true');
  });

  it('has no quick actions with the default template', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(screen.queryByRole('group', { name: 'Quick actions' })).toBeNull();
  });

  it('saves a rename from Settings', async () => {
    renderApp('/settings');
    const field = await screen.findByLabelText('Name of People');
    await userEvent.clear(field);
    await userEvent.type(field, 'Neighbours');
    await userEvent.tab();
    await waitFor(() => {
      expect(api.patchSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          layout: expect.objectContaining({ labels: { people: 'Neighbours' } }) as unknown,
        }),
      );
    });
  });
});
