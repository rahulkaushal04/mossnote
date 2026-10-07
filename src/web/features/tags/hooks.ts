import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { invalidateEverywhere } from '../../lib/broadcast';
import { ALL_DATA_KEYS, queryKeys } from '../../lib/queryKeys';

export const useTags = () => useQuery({ queryKey: queryKeys.tags, queryFn: api.listTags });

/** Tag changes touch every record that carries the tag, so they refresh everything (non-optimistic). */
export function useTagMutations() {
  const client = useQueryClient();
  const done = () => invalidateEverywhere(client, ALL_DATA_KEYS);
  return {
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) => api.patchTag(id, { name }),
      onSuccess: done,
    }),
    pin: useMutation({
      mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api.patchTag(id, { pinned }),
      onSuccess: done,
    }),
    merge: useMutation({
      mutationFn: ({ id, intoId }: { id: string; intoId: string }) => api.mergeTag(id, intoId),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteTag(id), onSuccess: done }),
  };
}
