import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@shared/schemas/settings';
import { api } from '../../lib/api';
import { invalidateEverywhere } from '../../lib/broadcast';
import { queryKeys } from '../../lib/queryKeys';

/**
 * Change the current game date. Optimistic (spec section 12): the cached settings update at once
 * and roll back if the server refuses.
 */
export function useSetCurrentDate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: number | null) => api.patchSettings({ currentGameDate: key }),
    onMutate: async (key) => {
      await client.cancelQueries({ queryKey: queryKeys.settings });
      const previous = client.getQueryData<Settings>(queryKeys.settings);
      if (previous)
        client.setQueryData<Settings>(queryKeys.settings, { ...previous, currentGameDate: key });
      return { previous };
    },
    onError: (_error, _key, context) => {
      if (context?.previous) client.setQueryData(queryKeys.settings, context.previous);
    },
    onSettled: () => invalidateEverywhere(client, [queryKeys.settings]),
  });
}
