// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode } from '@shared/gameDate';
import { api, ApiError, NetworkError } from '../lib/api';
import { mockApi, renderApp, settingsFixture } from '../testing';

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

  it('has the landmarks and the five destinations, with the current one marked', async () => {
    renderApp('/journal');
    await screen.findByRole('heading', { level: 1, name: 'Journal' });
    expect(screen.getByRole('main')).toBeTruthy();
    const nav = screen.getAllByRole('navigation', { name: 'Primary' }).at(0);
    if (!nav) throw new Error('No primary navigation.');
    const labels = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(labels).toEqual(['Today', 'Journal', 'People', 'Farm', 'Maps', 'Settings']);
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

  it('shows the section 21 copy on each destination', async () => {
    const copy: [string, string][] = [
      ['/journal', 'Your journal starts with your first note.'],
      ['/people', 'No people yet. Add someone above, or type @ in a note.'],
      ['/farm', 'Nothing here yet. Add an entry when you plant something.'],
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
      ['/farm', 'Farm'],
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

  it('/farm/:id is a sheet over the list, as a labelled modal dialog', async () => {
    renderApp('/farm/abc');
    expect(await screen.findByRole('dialog', { name: 'Farm entry' })).toBeTruthy();
    // The list stays in the document, behind the sheet (hidden from assistive technology).
    expect(screen.getByRole('heading', { level: 1, name: 'Farm', hidden: true })).toBeTruthy();
  });

  it('copy rule: no exclamation marks on any screen', async () => {
    for (const path of ['/', '/journal', '/people', '/farm', '/settings', '/nowhere', '/day/zzz']) {
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

describe('routes (spec section 7)', () => {
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
    renderApp(`/day/${encode({ year: 2, season: 3, day: 9 })}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Winter 9 · Year 2' }),
    ).toBeTruthy();
  });

  it('says an out-of-calendar day is not in the calendar and links to Today', async () => {
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

  it('narrow screens reach Settings from the top bar', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    const links = screen.getAllByRole('link', { name: 'Settings' });
    expect(links.some((a) => a.getAttribute('href') === '/settings')).toBe(true);
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

  it('both groups are labelled fieldsets reachable by keyboard', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Appearance' });
    expect(screen.getByRole('group', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Reading size' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Theme' })).getAllByRole('radio')).toHaveLength(
      3,
    );
    expect(
      within(screen.getByRole('group', { name: 'Reading size' })).getAllByRole('radio'),
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

describe('server unreachable (spec section 8.12)', () => {
  it('shows the full-page message with the start command and Retry', async () => {
    vi.spyOn(api, 'getHealth').mockRejectedValue(new NetworkError());
    renderApp('/journal');
    expect(await screen.findByRole('heading', { name: "Can't reach your journal." })).toBeTruthy();
    expect(screen.getByText('npm start')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('returns to the previous screen when Retry succeeds', async () => {
    const health = vi.spyOn(api, 'getHealth').mockRejectedValue(new NetworkError());
    renderApp('/journal');
    await screen.findByRole('heading', { name: "Can't reach your journal." });
    health.mockResolvedValue({ ok: true, version: 'test', schemaVersion: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Journal' })).toBeTruthy();
  });

  it('retries by itself every 5 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const health = vi.spyOn(api, 'getHealth').mockRejectedValue(new NetworkError());
    renderApp('/');
    await screen.findByRole('heading', { name: "Can't reach your journal." });
    const callsBefore = health.mock.calls.length;
    health.mockResolvedValue({ ok: true, version: 'test', schemaVersion: 2 });
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

describe('route error boundary (spec section 8.12)', () => {
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
      settingsFixture({
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
