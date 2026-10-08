// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalInfo } from '@shared/types';
import { recordExport } from '../lib/exports';
import { mockApi, renderWithProviders, settingsFixture } from '../testing';
import { BackupReminder } from './BackupReminder';

const DAY = 24 * 60 * 60 * 1000;

const journal = (overrides: Partial<JournalInfo> = {}): JournalInfo => ({
  id: 'journal',
  name: 'My journal',
  template: 'default',
  active: true,
  status: 'ok',
  bytes: 4096,
  createdAt: new Date(Date.now() - 30 * DAY).toISOString(),
  modifiedAt: new Date().toISOString(),
  counts: { notes: 3, people: 0, plantings: 0, maps: 0 },
  backups: 0,
  ...overrides,
});

const show = (info: JournalInfo) => {
  mockApi(settingsFixture(), { listJournals: { active: info.id, items: [info] } });
  return renderWithProviders(<BackupReminder />);
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the backup reminder', () => {
  it('asks for a copy of an older journal that was never downloaded', async () => {
    show(journal());

    expect(await screen.findByRole('region', { name: 'Backup reminder' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download a copy' }).getAttribute('href')).toBe(
      '/api/data/export.json',
    );
  });

  it('says how long ago the last copy was made when there was one', async () => {
    recordExport('journal', Date.now() - 20 * DAY);
    show(journal());

    expect(await screen.findByText(/last downloaded copy was 20 days ago/i)).toBeTruthy();
  });

  it('stays away from an empty journal, a new one, and one that was just exported', async () => {
    show(journal({ counts: { notes: 0, people: 0, plantings: 0, maps: 0 } }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Backup reminder' })).toBeNull();
    });
    cleanup();

    show(journal({ createdAt: new Date().toISOString() }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Backup reminder' })).toBeNull();
    });
    cleanup();

    recordExport('journal', Date.now());
    show(journal());
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Backup reminder' })).toBeNull();
    });
  });

  it('goes quiet for a few days when told to remind later', async () => {
    show(journal());

    await userEvent.click(await screen.findByRole('button', { name: 'Remind me later' }));

    expect(screen.queryByRole('region', { name: 'Backup reminder' })).toBeNull();
    cleanup();
    show(journal());
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Backup reminder' })).toBeNull();
    });
  });
});
