// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrashItem } from '@shared/types';
import { api, ApiError, NetworkError } from '../../lib/api';
import { mockApi, renderWithProviders } from '../../testing';
import { TrashSection } from './TrashSection';

const item = (overrides: Partial<TrashItem> = {}): TrashItem => ({
  kind: 'person',
  id: '01M4QR7BWFGVFTX8MNGGERYKEG',
  label: 'Ghost',
  deletedAt: '2026-10-12T15:18:00.000Z',
  ...overrides,
});

const gone = new ApiError(404, { code: 'not_found', message: 'That person is not here.' });
const broken = new ApiError(500, {
  code: 'internal',
  message: 'Something went wrong. Reference abc.',
});

const show = (items: TrashItem[] = [item()]) => {
  mockApi(undefined, { trash: { items } });
  const trash = vi.spyOn(api, 'trash').mockResolvedValue({ items });
  renderWithProviders(<TrashSection />);
  return trash;
};

beforeEach(() => {
  mockApi();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Settings → Recently deleted when something fails', () => {
  it('says so when a restore fails because the item is already gone, and refreshes the list', async () => {
    const trash = show();
    vi.spyOn(api, 'restoreFromTrash').mockRejectedValue(gone);

    await userEvent.click(await screen.findByRole('button', { name: 'Restore Ghost' }));

    expect(await screen.findByText('That person is not here.')).toBeTruthy();
    await waitFor(() => {
      expect(trash.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('says so when deleting one item forever fails', async () => {
    show();
    vi.spyOn(api, 'deleteForever').mockRejectedValue(gone);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete Ghost forever' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete forever' }));

    expect(await screen.findByText('That person is not here.')).toBeTruthy();
  });

  it('says so when emptying everything fails', async () => {
    show();
    vi.spyOn(api, 'emptyTrash').mockRejectedValue(broken);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete everything here forever' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Delete forever' }));

    expect(await screen.findByText('Something went wrong. Reference abc.')).toBeTruthy();
  });

  it('uses its own words when the server could not be reached at all', async () => {
    show();
    vi.spyOn(api, 'restoreFromTrash').mockRejectedValue(new NetworkError());

    await userEvent.click(await screen.findByRole('button', { name: 'Restore Ghost' }));

    expect(await screen.findByText("Couldn't restore that.")).toBeTruthy();
  });

  it('stays quiet when it works, and still refreshes the list', async () => {
    const trash = show();
    vi.spyOn(api, 'restoreFromTrash').mockResolvedValue({});

    await userEvent.click(await screen.findByRole('button', { name: 'Restore Ghost' }));

    await waitFor(() => {
      expect(trash.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Couldn't/)).toBeNull();
  });
});
