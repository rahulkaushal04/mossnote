import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsPatch } from '@shared/schemas/settings';
import { api } from '../../lib/api';
import { invalidateEverywhere } from '../../lib/broadcast';
import { ALL_DATA_KEYS, queryKeys } from '../../lib/queryKeys';

export const useSettings = () =>
  useQuery({ queryKey: queryKeys.settings, queryFn: api.getSettings });

/** Settings changes wait for the server, then refresh the cached settings. */
export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patchSettings(patch),
    onSuccess: (settings, patch) => {
      client.setQueryData(queryKeys.settings, settings);
      // A renamed season changes how every date is written, so everything refreshes.
      if (patch.calendar) void invalidateEverywhere(client, ALL_DATA_KEYS);
    },
  });
}
