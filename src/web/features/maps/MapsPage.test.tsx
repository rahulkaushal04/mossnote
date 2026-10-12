// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapPin, MapSummary, Page } from '@shared/types';
import { api } from '../../lib/api';
import { mockApi, renderApp } from '../../testing';

const map = (name: string): MapSummary => ({
  id: `M-${name}`,
  name,
  pinCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const pin = (label: string, mapName: string): MapPin & { mapName: string } => ({
  id: `PIN-${label}`,
  mapId: `M-${mapName}`,
  mapName,
  x: 0,
  y: 0,
  label,
  color: 'moss',
  note: '',
  props: {},
  target: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const firstMaps: Page<MapSummary> = { items: [map('Newest')], nextCursor: 'm1' };
const secondMaps: Page<MapSummary> = { items: [map('Oldest')], nextCursor: null };
const firstPlaces: Page<MapPin & { mapName: string }> = {
  items: [pin('Gate', 'Newest')],
  nextCursor: 'p1',
};
const secondPlaces: Page<MapPin & { mapName: string }> = {
  items: [pin('Cellar', 'Oldest')],
  nextCursor: null,
};

beforeEach(() => {
  mockApi();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Maps page with more than one page of maps and places', () => {
  it('loads every page of maps', async () => {
    const list = vi
      .spyOn(api, 'listMaps')
      .mockImplementation((cursor) => Promise.resolve(cursor === 'm1' ? secondMaps : firstMaps));
    vi.spyOn(api, 'places').mockResolvedValue({ items: [], nextCursor: null });
    renderApp('/maps');

    const maps = await screen.findByRole('list', { name: 'Maps' });
    expect(await within(maps).findByRole('link', { name: 'Oldest' })).toBeTruthy();
    expect(within(maps).getByRole('link', { name: 'Newest' })).toBeTruthy();
    expect(list.mock.calls.map((c) => c[0])).toEqual([undefined, 'm1']);
  });

  it('loads every page of places and filters across all of them', async () => {
    vi.spyOn(api, 'listMaps').mockResolvedValue({ items: [], nextCursor: null });
    const places = vi
      .spyOn(api, 'places')
      .mockImplementation((cursor) =>
        Promise.resolve(cursor === 'p1' ? secondPlaces : firstPlaces),
      );
    renderApp('/maps');

    const list = await screen.findByRole('list', { name: 'Places' });
    expect(await within(list).findByRole('link', { name: 'Cellar' })).toBeTruthy();
    expect(places.mock.calls.map((c) => c[0])).toEqual([undefined, 'p1']);

    await userEvent.type(screen.getByRole('textbox', { name: 'Filter places' }), 'cellar');

    expect(within(list).getByRole('link', { name: 'Cellar' })).toBeTruthy();
    expect(within(list).queryByRole('link', { name: 'Gate' })).toBeNull();
  });
});
