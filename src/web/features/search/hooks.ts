import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

/** Full search. Previous results stay on screen while typing, and stale requests are cancelled. */
export function useSearch(
  q: string,
  options: { kinds?: string; limit?: number; enabled?: boolean } = {},
) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: queryKeys.search(trimmed, `${options.kinds ?? ''}:${options.limit ?? ''}`),
    queryFn: ({ signal }) =>
      api.search(
        trimmed,
        {
          ...(options.kinds ? { kinds: options.kinds } : {}),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        },
        signal,
      ),
    enabled: trimmed !== '' && (options.enabled ?? true),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    retry: false,
  });
}

/** The five most recently edited notes, for the palette's empty state. */
export function useRecentNotes(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.pick('note', ''),
    queryFn: ({ signal }) => api.pick('note', '', [], signal),
    enabled,
    staleTime: 5_000,
  });
}
