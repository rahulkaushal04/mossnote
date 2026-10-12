import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlantingCreate, PlantingPatch } from '@shared/schemas/planting';
import type { Planting } from '@shared/types';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { invalidateEverywhere } from '../../lib/broadcast';
import { queryKeys } from '../../lib/queryKeys';
import { useAllPages } from '../../lib/useAllPages';

const AFTER_PLANTING_CHANGE: readonly (readonly unknown[])[] = [
  ['plantings'],
  ['planting'],
  ['tags'],
  ['notes'],
  ['note'],
  ['search'],
  ['pick'],
  ['trash'],
  ['fieldLabels'],
];

/** Every farm entry, a page at a time as they arrive. */
export function usePlantings(params: { tag?: string | undefined } = {}) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.plantings(params),
    queryFn: ({ pageParam }) =>
      api.listPlantings({
        ...(params.tag ? { tag: params.tag } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return useAllPages(query);
}

export const usePlanting = (id: string) =>
  useQuery({ queryKey: queryKeys.planting(id), queryFn: () => api.getPlanting(id) });

export function usePlantingNotes(id: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.plantingNotes(id),
    queryFn: ({ pageParam }) => api.plantingNotes(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCreatePlanting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PlantingCreate) => api.createPlanting(input),
    onSettled: () => invalidateEverywhere(client, AFTER_PLANTING_CHANGE),
  });
}

export function useUpdatePlanting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PlantingPatch }) =>
      api.patchPlanting(id, patch),
    onSuccess: (planting) => {
      client.setQueryData(queryKeys.planting(planting.id), planting);
    },
    onSettled: () => invalidateEverywhere(client, AFTER_PLANTING_CHANGE),
  });
}

export function useDeletePlanting() {
  const client = useQueryClient();
  const toast = useToast();
  const restore = useMutation({
    mutationFn: (id: string) => api.restorePlanting(id),
    onSettled: () => invalidateEverywhere(client, AFTER_PLANTING_CHANGE),
  });
  return useMutation({
    mutationFn: (planting: Planting) => api.deletePlanting(planting.id),
    onSuccess: (_void, planting) => {
      toast.show({
        message: 'Entry deleted',
        actionLabel: 'Undo',
        onAction: () => {
          restore.mutate(planting.id);
        },
      });
    },
    onError: () => {
      toast.show({ message: "Couldn't save that change. It was undone.", tone: 'alert' });
    },
    onSettled: () => invalidateEverywhere(client, AFTER_PLANTING_CHANGE),
  });
}
