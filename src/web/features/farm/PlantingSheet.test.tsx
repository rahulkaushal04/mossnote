// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Planting } from '@shared/types';
import { api, ApiError } from '../../lib/api';
import { mockApi, renderApp, stardewFixture } from '../../testing';

const planting = (overrides: Partial<Planting> = {}): Planting => ({
  id: '01M4QJE629YKJ62TQ4NW77D3PW',
  label: 'Parsnips',
  plantedOn: null,
  harvestedOn: null,
  plantedCount: null,
  harvestedCount: null,
  notes: 'Original entry note.',
  customFields: [{ label: 'Plot', value: 'North' }],
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
  ...overrides,
});

const stale = (current: Planting) =>
  new ApiError(409, {
    code: 'conflict',
    message: 'This entry changed in another window.',
    details: { current },
  });

const open = async (stored: Planting = planting()) => {
  mockApi(stardewFixture(), { getPlanting: stored });
  renderApp(`/farm/${stored.id}`);
  return screen.findByLabelText<HTMLTextAreaElement>(
    'Notes about this entry',
    {},
    { timeout: 4000 },
  );
};

const patchCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => c[1] as Record<string, unknown>);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Farm entry notes', () => {
  it('saves with the version of the entry it showed', async () => {
    const box = await open();
    const patch = vi
      .spyOn(api, 'patchPlanting')
      .mockResolvedValue(planting({ notes: 'Original entry note. More.' }));

    await userEvent.type(box, ' More.');
    await userEvent.tab();

    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(1);
    });
    expect(patchCalls(patch)[0]).toEqual({
      notes: 'Original entry note. More.',
      expectedUpdatedAt: '2026-01-01T00:00:01.000Z',
    });
  });

  it('asks which copy to keep when the notes changed in another window', async () => {
    const box = await open();
    vi.spyOn(api, 'patchPlanting').mockRejectedValue(
      stale(planting({ notes: 'Other window.', updatedAt: '2026-01-01T00:00:09.000Z' })),
    );

    await userEvent.type(box, ' Mine.');
    await userEvent.tab();

    expect(
      await screen.findByText('The notes changed in another window.', {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(box.value).toBe('Original entry note. Mine.');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(box.value).toBe('Other window.');
  });
});

describe('Farm entry fields', () => {
  it('saves with the version of the entry it showed, and asks when the fields changed elsewhere', async () => {
    await open();
    const patch = vi.spyOn(api, 'patchPlanting').mockRejectedValue(
      stale(
        planting({
          customFields: [{ label: 'Plot', value: 'South' }],
          updatedAt: '2026-01-01T00:00:09.000Z',
        }),
      ),
    );

    const value = await screen.findByDisplayValue('North', {}, { timeout: 4000 });
    await userEvent.type(value, 'x');
    await userEvent.tab();

    expect(
      await screen.findByText('The fields changed in another window.', {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(patchCalls(patch)[0]).toEqual({
      customFields: [{ label: 'Plot', value: 'Northx' }],
      expectedUpdatedAt: '2026-01-01T00:00:01.000Z',
    });
  });
});
