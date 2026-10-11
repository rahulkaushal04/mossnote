// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@shared/types';
import { api, ApiError, NetworkError } from '../../lib/api';
import { mockApi, renderWithProviders } from '../../testing';
import { CalendarProvider } from '../calendar/CalendarProvider';
import { EditableNote } from './EditableNote';

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: '01M4NKXCF5G6G3N7B48G3MWRM2',
  title: null,
  body: 'original',
  gameDate: null,
  isDiscovery: false,
  question: null,
  tags: [],
  links: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const staleError = (current: Note) =>
  new ApiError(409, {
    code: 'conflict',
    message: 'This note changed in another window.',
    details: { current },
  });

const bodyOf = (call: unknown[]) => (call[1] as { body?: string }).body;

function setup(note: Note = makeNote()) {
  const onDone = vi.fn();
  renderWithProviders(
    <CalendarProvider>
      <EditableNote note={note} onDone={onDone} defaultGameDate={null} />
    </CalendarProvider>,
  );
  return { onDone };
}

const typeIntoNote = async (text: string) => {
  const box = await screen.findByLabelText('Note');
  await userEvent.type(box, text);
};

const clickDone = () => userEvent.click(screen.getAllByRole('button', { name: 'Done' })[0]!);

beforeEach(() => {
  mockApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EditableNote', () => {
  it('closes after Done once the edit is saved', async () => {
    const saved = makeNote({ body: 'original more', updatedAt: '2026-01-01T00:00:01.000Z' });
    vi.spyOn(api, 'patchNote').mockResolvedValue(saved);
    const { onDone } = setup();

    await typeIntoNote(' more');
    await clickDone();

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  it('closes after Done when nothing changed', async () => {
    const patch = vi.spyOn(api, 'patchNote');
    const { onDone } = setup();

    await screen.findByLabelText('Note');
    await clickDone();

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('stays open with the typed text when the save fails', async () => {
    vi.spyOn(api, 'patchNote').mockRejectedValue(new NetworkError());
    const { onDone } = setup();

    await typeIntoNote(' precious');
    await clickDone();

    expect(await screen.findByText(/Your edit is still here/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Note').value).toBe('original precious');
  });

  it('lets the person discard an edit that cannot be saved', async () => {
    vi.spyOn(api, 'patchNote').mockRejectedValue(new NetworkError());
    const { onDone } = setup();
    await typeIntoNote(' precious');
    await clickDone();

    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('saves again on Done after a failed save once the server is back', async () => {
    const patch = vi
      .spyOn(api, 'patchNote')
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValue(makeNote({ body: 'original precious' }));
    const { onDone } = setup();
    await typeIntoNote(' precious');
    await clickDone();
    await screen.findByText(/Your edit is still here/);

    await clickDone();

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it('stays open while a newer version is waiting on the conflict choice', async () => {
    const newer = makeNote({ body: 'changed elsewhere', updatedAt: '2026-01-01T00:00:09.000Z' });
    vi.spyOn(api, 'patchNote').mockRejectedValue(staleError(newer));
    const { onDone } = setup();
    await typeIntoNote(' mine');
    await screen.findByText('This note changed in another window.', {}, { timeout: 3000 });

    await clickDone();

    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Note').value).toBe('original mine');
  });

  it('sends text typed during a running save before closing', async () => {
    const resolvers: ((note: Note) => void)[] = [];
    const patch = vi.spyOn(api, 'patchNote').mockImplementation(
      () =>
        new Promise<Note>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { onDone } = setup();
    await typeIntoNote(' A');
    fireEvent.focusOut(screen.getByLabelText('Note'));
    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(1);
    });
    await typeIntoNote('B');

    await clickDone();
    resolvers[0]?.(makeNote({ body: 'original A', updatedAt: '2026-01-01T00:00:01.000Z' }));

    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(2);
    });
    expect(bodyOf(patch.mock.calls[1]!)).toBe('original AB');
    expect(onDone).not.toHaveBeenCalled();
    resolvers[1]?.(makeNote({ body: 'original AB', updatedAt: '2026-01-01T00:00:02.000Z' }));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});
