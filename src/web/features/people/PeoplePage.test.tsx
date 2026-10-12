// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page, Person } from '@shared/types';
import { api, NetworkError } from '../../lib/api';
import { mockApi, renderApp } from '../../testing';

const person = (name: string): Person => ({
  id: `P-${name}`,
  name,
  notes: '',
  progress: null,
  progressMax: null,
  customFields: [],
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const first: Page<Person> = { items: [person('Alice')], nextCursor: 'c1' };
const second: Page<Person> = { items: [person('Zed')], nextCursor: null };

beforeEach(() => {
  mockApi();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('People page with more than one page of people', () => {
  it('loads every page, so the last person is on the list', async () => {
    const list = vi
      .spyOn(api, 'listPeople')
      .mockImplementation((query) => Promise.resolve(query?.cursor === 'c1' ? second : first));
    renderApp('/people');

    expect(await screen.findByRole('link', { name: 'Alice' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Zed' })).toBeTruthy();
    expect(list.mock.calls.map((c) => c[0]?.cursor)).toEqual([undefined, 'c1']);
  });

  it('filters across every page, not only the first', async () => {
    vi.spyOn(api, 'listPeople').mockImplementation((query) =>
      Promise.resolve(query?.cursor === 'c1' ? second : first),
    );
    renderApp('/people');
    await screen.findByRole('link', { name: 'Zed' });

    await userEvent.type(screen.getByRole('textbox', { name: 'Filter people' }), 'zed');

    expect(screen.getByRole('link', { name: 'Zed' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Alice' })).toBeNull();
  });

  it('notices a duplicate name that is on a later page', async () => {
    vi.spyOn(api, 'listPeople').mockImplementation((query) =>
      Promise.resolve(query?.cursor === 'c1' ? second : first),
    );
    renderApp('/people');
    await screen.findByRole('link', { name: 'Zed' });

    await userEvent.type(screen.getByRole('textbox', { name: 'Add someone' }), 'Zed');

    expect(await screen.findByText(/Someone with this name already exists/)).toBeTruthy();
  });

  it('does not say no one matches while the rest is still loading', async () => {
    let release: (page: Page<Person>) => void = () => undefined;
    vi.spyOn(api, 'listPeople').mockImplementation((query) =>
      query?.cursor === 'c1'
        ? new Promise<Page<Person>>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(first),
    );
    renderApp('/people');
    await screen.findByRole('link', { name: 'Alice' });

    await userEvent.type(screen.getByRole('textbox', { name: 'Filter people' }), 'zed');
    expect(screen.queryByText(/No one matches/)).toBeNull();
    expect(screen.getByText('Loading the rest…')).toBeTruthy();

    release(second);
    expect(await screen.findByRole('link', { name: 'Zed' })).toBeTruthy();
    expect(screen.queryByText('Loading the rest…')).toBeNull();
  });

  it('keeps the first page and offers a retry when a later page fails', async () => {
    const list = vi
      .spyOn(api, 'listPeople')
      .mockImplementation((query) =>
        query?.cursor === 'c1' ? Promise.reject(new NetworkError()) : Promise.resolve(first),
      );
    renderApp('/people');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alice' })).toBeTruthy();
    const calls = list.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(list.mock.calls.length).toBe(calls);

    list.mockImplementation((query) => Promise.resolve(query?.cursor === 'c1' ? second : first));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Zed' })).toBeTruthy();
    });
  });
});
