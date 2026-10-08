import type { ReactElement } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { COUNTER_CALENDAR, DEFAULT_CALENDAR } from '@shared/constants';
import type { Settings } from '@shared/schemas/settings';
import { DEFAULT_LAYOUT } from '@shared/templates';
import { ToastProvider } from './components/ui/Toast';
import { TooltipProvider } from './components/ui/Tooltip';
import { api } from './lib/api';
import { createQueryClient } from './lib/queryClient';
import { routes } from './app/routes';
import { vi } from 'vitest';

// jsdom has no layout, so it has no scrollIntoView either.
Element.prototype.scrollIntoView = () => undefined;

/** A journal made from the Default template: a day counter, no Farm section. */
export const settingsFixture = (overrides: Partial<Settings> = {}): Settings => ({
  calendar: COUNTER_CALENDAR,
  currentGameDate: null,
  prefs: { readingSize: 'comfortable', hintDismissed: false },
  layout: DEFAULT_LAYOUT,
  markerTypes: [],
  meta: { createdAt: 1, journalName: 'journal' },
  ...overrides,
});

/** A journal made from the Stardew Valley template: seasons, a Farm section, quick actions. */
export const stardewFixture = (overrides: Partial<Settings> = {}): Settings =>
  settingsFixture({
    calendar: DEFAULT_CALENDAR,
    layout: { ...DEFAULT_LAYOUT, template: 'stardew' },
    ...overrides,
  });

const emptyPage = { items: [], nextCursor: null };

/** Stub the API module: an empty, spoiler-free journal. Network behaviour is covered by the server tests. */
export function mockApi(
  settings: Settings = settingsFixture(),
  /** Replace the canned answer of any API function. */
  overrides: Record<string, unknown> = {},
) {
  const defaults: Record<string, unknown> = {
    getHealth: { ok: true, version: 'test', schemaVersion: 4, journal: 'journal' },
    listJournals: {
      active: 'journal',
      items: [
        {
          id: 'journal',
          name: 'My journal',
          template: settings.layout.template,
          active: true,
          status: 'ok',
          bytes: 4096,
          createdAt: null,
          modifiedAt: '2026-01-01T00:00:00.000Z',
          counts: { notes: 0, people: 0, plantings: 0, maps: 0 },
          backups: 0,
        },
      ],
    },
    getSettings: settings,
    listNotes: emptyPage,
    countNotes: { count: 0 },
    listPeople: emptyPage,
    listPlantings: emptyPage,
    personNotes: emptyPage,
    plantingNotes: emptyPage,
    fieldLabels: { labels: [] },
    listTags: [],
    pick: { items: [] },
    search: {
      groups: { notes: [], people: [], plantings: [], tags: [], maps: [] },
      partial: false,
    },
    dataInfo: {
      dataDir: '/data/Mossnote',
      backupsDir: '/data/Mossnote/backups',
      databasePath: '/data/Mossnote/journal.db',
      databaseBytes: 4096,
      journal: { id: 'journal', name: 'My journal' },
      counts: { notes: 0, people: 0, plantings: 0, tags: 0, maps: 0 },
      lastBackupAt: null,
      backupCount: 0,
      backupBytes: 0,
    },
    backups: { items: [] },
    trash: { items: [] },
    ...overrides,
  };
  const functions = api as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of Object.keys(functions)) {
    const value = name in defaults ? defaults[name] : undefined;
    vi.spyOn(functions, name).mockImplementation(() => Promise.resolve(value));
  }
  vi.spyOn(api, 'patchSettings').mockImplementation((patch) =>
    Promise.resolve({
      ...settings,
      ...(patch.calendar ? { calendar: patch.calendar } : {}),
      ...(patch.currentGameDate === undefined ? {} : { currentGameDate: patch.currentGameDate }),
      prefs: { ...settings.prefs, ...patch.prefs },
      ...(patch.layout ? { layout: patch.layout } : {}),
    }),
  );
}

export function renderWithProviders(ui: ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>{ui}</ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

export function renderApp(path = '/') {
  const client = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...view, router, client };
}
