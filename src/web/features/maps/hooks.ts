/**
 * Data hooks for maps (TanStack Query): the list, one map, places, and pins pointing at a record.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MapCreate } from '@shared/schemas/map';
import type { MapSummary } from '@shared/types';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { invalidateEverywhere } from '../../lib/broadcast';
import { queryKeys } from '../../lib/queryKeys';

const AFTER_MAP_CHANGE: readonly (readonly unknown[])[] = [
  ['maps'],
  ['search'],
  ['pick'],
  ['trash'],
  ['data'],
];

export const useMaps = () => useQuery({ queryKey: queryKeys.maps, queryFn: api.listMaps });

export const usePlaces = () => useQuery({ queryKey: queryKeys.places, queryFn: api.places });

/** The editor keeps its own working copy, so the map is fetched once per visit. */
export const useMap = (id: string) =>
  useQuery({
    queryKey: queryKeys.map(id),
    queryFn: () => api.getMap(id),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

/** Pins that point at a record, for its "On maps" section. */
export const usePinsFor = (type: 'note' | 'person' | 'planting', id: string) =>
  useQuery({ queryKey: queryKeys.pinsFor(type, id), queryFn: () => api.pinsFor(type, id) });

export function useCreateMap() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: MapCreate) => api.createMap(input),
    onSettled: () => invalidateEverywhere(client, AFTER_MAP_CHANGE),
  });
}

export const refreshMaps = (client: ReturnType<typeof useQueryClient>) =>
  invalidateEverywhere(client, AFTER_MAP_CHANGE);

export function useDeleteMap() {
  const client = useQueryClient();
  const toast = useToast();
  const restore = useMutation({
    mutationFn: (id: string) => api.restoreMap(id),
    onSettled: () => invalidateEverywhere(client, AFTER_MAP_CHANGE),
  });
  return useMutation({
    mutationFn: (map: Pick<MapSummary, 'id'>) => api.deleteMap(map.id),
    onSuccess: (_void, map) => {
      toast.show({
        message: 'Map deleted',
        actionLabel: 'Undo',
        onAction: () => {
          restore.mutate(map.id);
        },
      });
    },
    onError: () => {
      toast.show({ message: "Couldn't save that change. It was undone.", tone: 'alert' });
    },
    onSettled: () => invalidateEverywhere(client, AFTER_MAP_CHANGE),
  });
}
