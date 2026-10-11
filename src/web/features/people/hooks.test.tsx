// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '@shared/types';
import * as toastModule from '../../components/ui/Toast';
import { api, NetworkError } from '../../lib/api';
import { useSavePerson } from './hooks';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const spyOnToast = () => {
  const show = vi.fn();
  vi.spyOn(toastModule, 'useToast').mockReturnValue({ show } as never);
  return show;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useSavePerson', () => {
  it('sends the change for that person', async () => {
    spyOnToast();
    const patch = vi.spyOn(api, 'patchPerson').mockResolvedValue({ id: 'P' } as Person);
    const { result } = renderHook(() => useSavePerson('P'), { wrapper });

    act(() => {
      result.current({ name: 'New name' });
    });

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('P', { name: 'New name' });
    });
  });

  it('tells the person when the change could not be saved', async () => {
    const show = spyOnToast();
    vi.spyOn(api, 'patchPerson').mockRejectedValue(new NetworkError());
    const { result } = renderHook(() => useSavePerson('P'), { wrapper });

    act(() => {
      result.current({ name: 'New name' });
    });

    await waitFor(() => {
      expect((show.mock.calls[0]?.[0] as { message: string }).message).toBe(
        "Couldn't save that change.",
      );
    });
  });

  it('stays quiet when the change is saved', async () => {
    const show = spyOnToast();
    vi.spyOn(api, 'patchPerson').mockResolvedValue({ id: 'P' } as Person);
    const { result } = renderHook(() => useSavePerson('P'), { wrapper });

    act(() => {
      result.current({ name: 'New name' });
    });

    await waitFor(() => {
      expect(api.patchPerson).toHaveBeenCalled();
    });
    expect(show).not.toHaveBeenCalled();
  });
});
