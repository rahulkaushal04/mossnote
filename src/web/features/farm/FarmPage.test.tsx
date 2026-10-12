// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page, Planting } from '@shared/types';
import { api } from '../../lib/api';
import { mockApi, renderApp, stardewFixture } from '../../testing';

const entry = (label: string, overrides: Partial<Planting> = {}): Planting => ({
  id: `F-${label}`,
  label,
  plantedOn: null,
  harvestedOn: null,
  plantedCount: null,
  harvestedCount: null,
  notes: '',
  customFields: [],
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const first: Page<Planting> = {
  items: [entry('Parsnips', { plantedOn: 10101 })],
  nextCursor: 'c1',
};
const second: Page<Planting> = {
  items: [entry('Melons', { plantedOn: 10102 }), entry('Old crop')],
  nextCursor: null,
};

beforeEach(() => {
  mockApi(stardewFixture());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Farm page with more than one page of entries', () => {
  it('loads every page and counts the groups over all of them', async () => {
    const list = vi
      .spyOn(api, 'listPlantings')
      .mockImplementation((query) => Promise.resolve(query?.cursor === 'c1' ? second : first));
    renderApp('/farm');

    expect(await screen.findByRole('link', { name: /Melons/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Parsnips/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Old crop/ })).toBeTruthy();
    expect(list.mock.calls.map((c) => c[0]?.cursor)).toEqual([undefined, 'c1']);
    const growing = screen.getByRole('region', { name: 'Growing' });
    expect(growing.querySelector('.tnum')?.textContent).toBe('2');
  });
});
