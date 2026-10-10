// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_TEMPLATE_URL } from '@shared/links';
import type { BackupInfo, JournalInfo } from '@shared/types';
import { api, ApiError } from '../../lib/api';
import {
  journalNav,
  markJournalChanged,
  resetJournalState,
  setCurrentJournal,
} from '../../lib/journal';
import { mockApi, renderApp, settingsFixture } from '../../testing';

const journal = (overrides: Partial<JournalInfo>): JournalInfo => ({
  id: 'journal',
  name: 'My journal',
  template: 'default',
  active: true,
  status: 'ok',
  bytes: 8192,
  createdAt: null,
  modifiedAt: '2026-01-01T00:00:00.000Z',
  counts: { notes: 3, people: 1, plantings: 0, maps: 0 },
  backups: 1,
  ...overrides,
});

const TWO = {
  active: 'journal',
  items: [
    journal({}),
    journal({
      id: 'second-game',
      name: 'Second game',
      template: 'stardew',
      active: false,
      counts: { notes: 9, people: 2, plantings: 4, maps: 1 },
    }),
  ],
};

let show: ReturnType<typeof vi.spyOn>;
let reload: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  resetJournalState();
  mockApi(settingsFixture(), { listJournals: TWO });
  show = vi.spyOn(journalNav, 'show').mockImplementation(() => undefined);
  reload = vi.spyOn(journalNav, 'reload').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the first run', () => {
  const firstRun = () => {
    vi.spyOn(api, 'getHealth').mockResolvedValue({
      ok: true,
      version: 'test',
      schemaVersion: 0,
      journal: null,
    });
  };

  it('asks "Which template?" with Default chosen, and links to the request form', async () => {
    firstRun();
    renderApp('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Welcome to Mossnote' }),
    ).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Which template?' });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios.map((r) => r.value)).toEqual(['default', 'stardew']);
    expect(radios.find((r) => r.checked)?.value).toBe('default');
    const link = screen.getByRole('link', { name: 'Request a template' });
    expect(link.getAttribute('href')).toBe(REQUEST_TEMPLATE_URL);
    expect(link.getAttribute('rel')).toContain('noopener');
    // No journal chrome yet: no navigation, nothing else to do first.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(document.title).toBe('Welcome · Mossnote');
  });

  it('makes a journal: choose a template, type a name, press Enter', async () => {
    firstRun();
    const create = vi.spyOn(api, 'createJournal').mockResolvedValue(journal({ id: 'a' }));
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: /Stardew Valley/ }));
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Stardew Valley/ }).checked).toBe(
      true,
    );
    const name = screen.getByLabelText('Journal name');
    await user.clear(name);
    await user.type(name, 'Farm game{Enter}');
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({ name: 'Farm game', template: 'stardew' });
    });
    await waitFor(() => {
      expect(show).toHaveBeenCalled();
    });
  });

  it('keeps the form and says what went wrong, in plain words, when the name is empty or the server refuses', async () => {
    firstRun();
    const create = vi
      .spyOn(api, 'createJournal')
      .mockRejectedValue(
        new ApiError(400, { code: 'validation_failed', message: 'Names need 1 to 60 characters.' }),
      );
    renderApp('/');
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Journal name');
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Start my journal' }));
    expect(screen.getByText(/Give the journal a name/)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    await user.type(name, 'x');
    await user.click(screen.getByRole('button', { name: 'Start my journal' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Names need 1 to 60 characters.',
    );
    expect(show).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Start my journal' }).disabled,
    ).toBe(false);
  });
});

describe('the journal switcher', () => {
  it('names the open journal, lists the others with their template, and switches', async () => {
    const activate = vi.spyOn(api, 'activateJournal').mockResolvedValue(TWO.items[1]!);
    renderApp('/');
    const user = userEvent.setup();
    const trigger = (
      await screen.findAllByRole('button', { name: 'Journal: My journal. Switch journal' })
    )[0];
    if (!trigger) throw new Error('No switcher.');
    await user.click(trigger);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      '✓ My journalDefault',
      'Second gameStardew Valley',
      'New journal…',
      'Rename this journal…',
      'Manage journals',
    ]);
    await user.click(screen.getByRole('menuitem', { name: /Second game/ }));
    await waitFor(() => {
      expect(activate).toHaveBeenCalledWith('second-game');
    });
    await waitFor(() => {
      expect(show).toHaveBeenCalled();
    });
  });

  it('shows a journal made by a newer Mossnote as unavailable, not as a trap', async () => {
    mockApi(settingsFixture(), {
      listJournals: {
        active: 'journal',
        items: [
          TWO.items[0],
          journal({ id: 'future', name: 'future', active: false, status: 'needs_newer_app' }),
        ],
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    const trigger = (await screen.findAllByRole('button', { name: /Switch journal/ }))[0];
    if (!trigger) throw new Error('No switcher.');
    await user.click(trigger);
    const item = await screen.findByRole('menuitem', { name: /future/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Needs a newer Mossnote');
  });

  it('makes a new journal from the menu, asking for a name and a template', async () => {
    const create = vi.spyOn(api, 'createJournal').mockResolvedValue(journal({ id: 'b' }));
    renderApp('/');
    const user = userEvent.setup();
    const trigger = (await screen.findAllByRole('button', { name: /Switch journal/ }))[0];
    if (!trigger) throw new Error('No switcher.');
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'New journal…' }));
    const dialog = await screen.findByRole('dialog', { name: 'New journal' });
    expect(within(dialog).getByRole('group', { name: 'Which template?' })).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Journal name'), 'Third game');
    await user.click(within(dialog).getByRole('button', { name: 'Create journal' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({ name: 'Third game', template: 'default' });
    });
  });
});

describe('Settings → Journals', () => {
  it('lists every journal with its template and counts, and opens one', async () => {
    const activate = vi.spyOn(api, 'activateJournal').mockResolvedValue(TWO.items[1]!);
    renderApp('/settings');
    const list = await screen.findByRole('list', { name: 'Journals' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('My journal');
    expect(rows[0]?.textContent).toContain('(open now)');
    expect(rows[1]?.textContent).toContain('Stardew Valley · 9 notes · 2 people · 1 map');
    expect(within(rows[0]!).queryByRole('button', { name: 'Open My journal' })).toBeNull();
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Open Second game' }));
    await waitFor(() => {
      expect(activate).toHaveBeenCalledWith('second-game');
    });
  });

  it('renames a journal', async () => {
    const rename = vi.spyOn(api, 'renameJournal').mockResolvedValue(TWO.items[1]!);
    renderApp('/settings');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rename Second game' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename journal' });
    const field = within(dialog).getByLabelText('Journal name');
    await user.clear(field);
    await user.type(field, 'Renamed{Enter}');
    await waitFor(() => {
      expect(rename).toHaveBeenCalledWith('second-game', 'Renamed');
    });
  });

  it('will not delete until the journal’s name is typed, and offers copies and a last snapshot', async () => {
    const remove = vi
      .spyOn(api, 'deleteJournal')
      .mockResolvedValue({ active: 'journal', snapshot: 'x.db' });
    renderApp('/settings');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete Second game' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “Second game”?' });
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', {
      name: 'Delete journal',
    });
    expect(confirm.disabled).toBe(true);
    expect(within(dialog).getByRole('link', { name: 'Download JSON' }).getAttribute('href')).toBe(
      '/api/journals/second-game/export.json',
    );
    expect(
      within(dialog).getByRole('link', { name: 'Download Markdown' }).getAttribute('href'),
    ).toBe('/api/journals/second-game/export.md');
    const keep = within(dialog).getByRole<HTMLInputElement>('checkbox');
    expect(keep.checked).toBe(true);

    const field = within(dialog).getByLabelText(/Type the journal.s name to confirm/);
    await user.type(field, 'Second gam');
    expect(confirm.disabled).toBe(true);
    await user.type(field, 'e');
    expect(confirm.disabled).toBe(false);
    await user.click(keep);
    await user.click(confirm);
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('second-game', {
        confirmName: 'Second game',
        finalSnapshot: false,
      });
    });
    await waitFor(() => {
      expect(show).toHaveBeenCalled();
    });
  });

  it('keeps the journal and says so when deleting fails', async () => {
    vi.spyOn(api, 'deleteJournal').mockRejectedValue(
      new ApiError(409, {
        code: 'conflict',
        message: 'That journal is open in another copy of Mossnote. Close that one first.',
      }),
    );
    renderApp('/settings');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete Second game' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Type the journal.s name/), 'Second game');
    await user.click(within(dialog).getByRole('button', { name: 'Delete journal' }));
    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      'That journal is open in another copy of Mossnote. Close that one first.',
    );
    expect(show).not.toHaveBeenCalled();
  });

  it('shows the template as fixed, with the pointer for requesting another', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Template and sections' });
    expect(screen.queryByRole('radio', { name: /Stardew/ })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Request a template' }).length).toBeGreaterThan(0);
    expect(screen.getByText(/keeps the template it started with/)).toBeTruthy();
  });

  it('shows a day-counter journal with no season editor', async () => {
    renderApp('/settings');
    expect(await screen.findByText(/This journal just counts days/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add season' })).toBeNull();
  });
});

describe('snapshots in Settings', () => {
  const snap = (name: string, reason: BackupInfo['reason']): BackupInfo => ({
    name,
    reason,
    size: 20480,
    takenAt: '2026-03-04T10:00:00.000Z',
  });

  it('lists them with their reason, and restores one only after a confirmation that says what happens', async () => {
    mockApi(settingsFixture(), {
      listJournals: TWO,
      backups: { items: [snap('a-auto.db', 'auto'), snap('b-pre.db', 'pre-migration')] },
    });
    const restore = vi.spyOn(api, 'restoreBackup').mockResolvedValue({
      restored: snap('a-auto.db', 'auto'),
      safety: snap('safety.db', 'pre-restore'),
    });
    renderApp('/settings');
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Snapshots' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Automatic');
    expect(rows[1]?.textContent).toContain('Before an update');
    await user.click(within(rows[0]!).getByRole('button', { name: /^Restore the snapshot/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Restore this snapshot?' });
    expect(dialog.textContent).toContain('saved as a snapshot first');
    expect(restore).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith('a-auto.db');
    });
    await waitFor(() => {
      expect(reload).toHaveBeenCalled();
    });
  });

  it('deletes one after a confirmation, and has a calm empty state', async () => {
    mockApi(settingsFixture(), {
      listJournals: TWO,
      backups: { items: [snap('old.db', 'manual')] },
    });
    const del = vi.spyOn(api, 'deleteBackup').mockResolvedValue(undefined);
    renderApp('/settings');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Delete the snapshot/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this snapshot?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete snapshot' }));
    await waitFor(() => {
      expect(del).toHaveBeenCalledWith('old.db');
    });
    cleanup();
    mockApi(settingsFixture(), { listJournals: TWO });
    renderApp('/settings');
    expect(await screen.findByText(/No snapshots yet/)).toBeTruthy();
  });

  it('shows where the data lives, with Copy and Open folder', async () => {
    const open = vi.spyOn(api, 'openDataFolder').mockResolvedValue(undefined);
    renderApp('/settings');
    expect((await screen.findAllByText('/data/Mossnote')).length).toBeGreaterThan(0);
    expect(screen.getByText(/\/data\/Mossnote\/journal\.db/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(open).toHaveBeenCalled();
  });
});

describe('a window that is showing another journal', () => {
  it('tells the person, with a way to reload, instead of letting them write', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    markJournalChanged();
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('You switched journals in another window');
    expect(within(banner).getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('names its journal on every request so the server can refuse a stale window', async () => {
    vi.restoreAllMocks();
    const seen: string[] = [];
    vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push(headers.get('x-moss-journal') ?? 'none');
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    await api.getHealth();
    setCurrentJournal('abc');
    await api.getHealth();
    vi.unstubAllGlobals();
    expect(seen).toEqual(['none', 'abc']);
  });
});
