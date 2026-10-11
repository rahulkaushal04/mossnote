// @vitest-environment jsdom
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '@shared/types';
import { api, NetworkError } from '../../lib/api';
import { mockApi, renderWithProviders } from '../../testing';
import { CalendarProvider } from '../calendar/CalendarProvider';
import { CaptureEditor } from './CaptureEditor';
import { emptyDraft, type NoteDraft } from './draft';

function Harness() {
  const [draft, setDraft] = useState<NoteDraft>(emptyDraft());
  return <CaptureEditor value={draft} onChange={setDraft} defaultGameDate={null} mode="compose" />;
}

const bodyText = () => screen.getByLabelText<HTMLTextAreaElement>('Note').value;

const setup = () =>
  renderWithProviders(
    <MemoryRouter>
      <CalendarProvider>
        <Harness />
      </CalendarProvider>
    </MemoryRouter>,
  );

const chooseCreatePerson = async (typed: string) => {
  const box = await screen.findByLabelText('Note');
  await userEvent.click(box);
  await userEvent.type(box, typed);
  await userEvent.click(await screen.findByText(/Create person/));
  return box;
};

beforeEach(() => {
  mockApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('creating a person from the @ picker', () => {
  it('keeps what was typed while the person was being created', async () => {
    let finish!: (person: Person) => void;
    vi.spyOn(api, 'createPerson').mockImplementation(
      () =>
        new Promise<Person>((resolve) => {
          finish = resolve;
        }),
    );
    setup();
    const box = await chooseCreatePerson('met @Zed');
    await userEvent.type(box, ' and then more words');

    await act(async () => {
      finish({ id: '01M4NKXCF5G6G3N7B48G3MWRM2', name: 'Zed' } as Person);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(bodyText()).toBe('met Zed and then more words');
    });
  });

  it('says so, and keeps the text, when the person could not be created', async () => {
    vi.spyOn(api, 'createPerson').mockRejectedValue(new NetworkError());
    setup();

    await chooseCreatePerson('met @Zed');

    expect(await screen.findByText("Couldn't add that person.")).toBeTruthy();
    expect(bodyText()).toBe('met @Zed');
  });
});
