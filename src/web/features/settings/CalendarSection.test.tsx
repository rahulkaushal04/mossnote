// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { mockApi, renderWithProviders, stardewFixture } from '../../testing';
import { CalendarProvider } from '../calendar/CalendarProvider';
import { CalendarSection } from './CalendarSection';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const show = async () => {
  mockApi(stardewFixture());
  renderWithProviders(
    <CalendarProvider>
      <CalendarSection />
    </CalendarProvider>,
  );
  await screen.findByRole('textbox', { name: 'Season 1 name' });
};

describe('Settings → Calendar', () => {
  it('offers removal on the last season only', async () => {
    await show();

    const remove = screen.getAllByRole('button', { name: /^remove /i });
    expect(remove.map((b) => b.getAttribute('aria-label'))).toEqual(['Remove Winter']);
  });

  it('removes the last season and saves the shorter calendar', async () => {
    await show();
    const save = vi.spyOn(api, 'patchSettings').mockResolvedValue(stardewFixture());

    await userEvent.click(screen.getByRole('button', { name: 'Remove Winter' }));
    expect(screen.queryByRole('textbox', { name: 'Season 4 name' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Fall' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Save calendar' }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        calendar: {
          seasons: [
            { name: 'Spring', days: 28 },
            { name: 'Summer', days: 28 },
            { name: 'Fall', days: 28 },
          ],
        },
      });
    });
  });
});
