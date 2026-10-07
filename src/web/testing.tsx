import type { ReactElement } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { DEFAULT_CALENDAR } from '@shared/constants';
import type { Settings } from '@shared/schemas/settings';
import { DEFAULT_LAYOUT } from '@shared/templates';
import { ToastProvider } from './components/ui/Toast';
import { TooltipProvider } from './components/ui/Tooltip';
import { api } from './lib/api';
import { createQueryClient } from './lib/queryClient';
import { routes } from './app/routes';
import { vi } from 'vitest';

export const settingsFixture = (overrides: Partial<Settings> = {}): Settings => ({
  calendar: DEFAULT_CALENDAR,
  currentGameDate: null,
  prefs: { readingSize: 'comfortable', hintDismissed: false },
  layout: DEFAULT_LAYOUT,
  markerTypes: [],
  meta: { createdAt: 1, journalName: 'journal' },
  ...overrides,
});

const emptyPage = { items: [], nextCursor: null };

/** Stub the API module: an empty, spoiler-free journal. Network behaviour is covered by the server tests. */
export function mockApi(settings: Settings = settingsFixture()) {
  const defaults: Record<string, unknown> = {
    getHealth: { ok: true, version: 'test', schemaVersion: 2 },
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
      databasePath: '/data/Mossnote/journal.db',
      databaseBytes: 4096,
      counts: { notes: 0, people: 0, plantings: 0, tags: 0, maps: 0 },
      lastBackupAt: null,
    },
    backups: { items: [] },
    trash: { items: [] },
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
