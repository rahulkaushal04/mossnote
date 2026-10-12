// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '@shared/types';
import { api, ApiError } from '../../lib/api';
import { mockApi, renderApp } from '../../testing';

const person = (overrides: Partial<Person> = {}): Person => ({
  id: '01M4QJE618P415QA31RAXDDQVX',
  name: 'Robin',
  notes: 'Original note.',
  progress: null,
  progressMax: null,
  customFields: [{ label: 'Shop', value: 'Carpenter' }],
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
  ...overrides,
});

const stale = (current: Person) =>
  new ApiError(409, {
    code: 'conflict',
    message: 'This person changed in another window.',
    details: { current },
  });

const open = async (stored: Person = person()) => {
  mockApi(undefined, { getPerson: stored });
  renderApp(`/people/${stored.id}`);
  return screen.findByLabelText<HTMLTextAreaElement>(
    'Notes about this person',
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

describe('Person page notes', () => {
  it('saves with the version of the person it showed', async () => {
    const box = await open();
    const patch = vi
      .spyOn(api, 'patchPerson')
      .mockResolvedValue(person({ notes: 'Original note. More.' }));

    await userEvent.type(box, ' More.');
    await userEvent.tab();

    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(1);
    });
    expect(patchCalls(patch)[0]).toEqual({
      notes: 'Original note. More.',
      expectedUpdatedAt: '2026-01-01T00:00:01.000Z',
    });
  });

  it('builds the next save on the version the last one returned', async () => {
    const box = await open();
    const patch = vi
      .spyOn(api, 'patchPerson')
      .mockResolvedValueOnce(
        person({ notes: 'Original note. A', updatedAt: '2026-01-01T00:00:05.000Z' }),
      )
      .mockResolvedValueOnce(
        person({ notes: 'Original note. AB', updatedAt: '2026-01-01T00:00:06.000Z' }),
      );

    await userEvent.type(box, ' A');
    await userEvent.tab();
    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(1);
    });
    await userEvent.type(box, 'B');
    await userEvent.tab();

    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(2);
    });
    expect(patchCalls(patch)[1]?.expectedUpdatedAt).toBe('2026-01-01T00:00:05.000Z');
  });

  it('asks which copy to keep when the notes changed in another window, and keeps both on screen', async () => {
    const box = await open();
    vi.spyOn(api, 'patchPerson').mockRejectedValue(
      stale(
        person({ notes: 'Written in the other window.', updatedAt: '2026-01-01T00:00:09.000Z' }),
      ),
    );

    await userEvent.type(box, ' Mine.');
    await userEvent.tab();

    expect(
      await screen.findByText('The notes changed in another window.', {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(box.value).toBe('Original note. Mine.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeTruthy();
  });

  it('Reload shows the other window’s text and sends nothing', async () => {
    const box = await open();
    const patch = vi
      .spyOn(api, 'patchPerson')
      .mockRejectedValue(
        stale(
          person({ notes: 'Written in the other window.', updatedAt: '2026-01-01T00:00:09.000Z' }),
        ),
      );
    await userEvent.type(box, ' Mine.');
    await userEvent.tab();
    await userEvent.click(await screen.findByRole('button', { name: 'Reload' }, { timeout: 4000 }));

    expect(box.value).toBe('Written in the other window.');
    expect(screen.queryByText('The notes changed in another window.')).toBeNull();
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('Keep mine saves this window’s text over the other one', async () => {
    const box = await open();
    const patch = vi
      .spyOn(api, 'patchPerson')
      .mockRejectedValueOnce(
        stale(
          person({ notes: 'Written in the other window.', updatedAt: '2026-01-01T00:00:09.000Z' }),
        ),
      )
      .mockResolvedValueOnce(person({ notes: 'Original note. Mine.' }));
    await userEvent.type(box, ' Mine.');
    await userEvent.tab();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Keep mine' }, { timeout: 4000 }),
    );

    await waitFor(
      () => {
        expect(patch).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
    expect(patchCalls(patch)[1]).toEqual({
      notes: 'Original note. Mine.',
      expectedUpdatedAt: '2026-01-01T00:00:09.000Z',
    });
    expect(box.value).toBe('Original note. Mine.');
  });

  it('saves again without asking when something else about the person changed elsewhere', async () => {
    const box = await open();
    const patch = vi
      .spyOn(api, 'patchPerson')
      .mockRejectedValueOnce(
        stale(person({ tags: ['new'], updatedAt: '2026-01-01T00:00:09.000Z' })),
      )
      .mockResolvedValueOnce(person({ notes: 'Original note. Mine.' }));

    await userEvent.type(box, ' Mine.');
    await userEvent.tab();

    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(2);
    });
    expect(patchCalls(patch)[1]?.expectedUpdatedAt).toBe('2026-01-01T00:00:09.000Z');
    expect(screen.queryByText('The notes changed in another window.')).toBeNull();
  });
});

describe('Person page fields', () => {
  it('saves with the version of the person it showed, and asks when the fields changed elsewhere', async () => {
    await open();
    const patch = vi.spyOn(api, 'patchPerson').mockRejectedValue(
      stale(
        person({
          customFields: [{ label: 'Shop', value: 'Mountain' }],
          updatedAt: '2026-01-01T00:00:09.000Z',
        }),
      ),
    );

    const value = await screen.findByDisplayValue('Carpenter', {}, { timeout: 4000 });
    await userEvent.type(value, 's');
    await userEvent.tab();

    expect(
      await screen.findByText('The fields changed in another window.', {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(patchCalls(patch)[0]).toEqual({
      customFields: [{ label: 'Shop', value: 'Carpenters' }],
      expectedUpdatedAt: '2026-01-01T00:00:01.000Z',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(screen.getByDisplayValue('Mountain')).toBeTruthy();
  });
});
