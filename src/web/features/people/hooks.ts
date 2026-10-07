import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PersonCreate, PersonPatch } from '@shared/schemas/person';
import type { Person } from '@shared/types';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { invalidateEverywhere } from '../../lib/broadcast';
import { queryKeys } from '../../lib/queryKeys';

const AFTER_PERSON_CHANGE: readonly (readonly unknown[])[] = [
  ['people'],
  ['person'],
  ['tags'],
  ['notes'],
  ['note'],
  ['search'],
  ['pick'],
  ['trash'],
  ['fieldLabels'],
];

export const usePeople = (params: { tag?: string | undefined; sort: 'name' | 'updated' }) =>
  useQuery({
    queryKey: queryKeys.people(params),
    queryFn: () =>
      api.listPeople({ ...(params.tag ? { tag: params.tag } : {}), sort: params.sort }),
  });

export const usePerson = (id: string) =>
  useQuery({ queryKey: queryKeys.person(id), queryFn: () => api.getPerson(id) });

/** Notes that link to a person, newest first, a page at a time. */
export function usePersonNotes(id: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.personNotes(id),
    queryFn: ({ pageParam }) => api.personNotes(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCreatePerson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PersonCreate) => api.createPerson(input),
    onSettled: () => invalidateEverywhere(client, AFTER_PERSON_CHANGE),
  });
}

/** Autosaving edits. Cached data is replaced with the server's answer. */
export function useUpdatePerson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PersonPatch }) => api.patchPerson(id, patch),
    onSuccess: (person) => {
      client.setQueryData(queryKeys.person(person.id), person);
    },
    onSettled: () => invalidateEverywhere(client, AFTER_PERSON_CHANGE),
  });
}

export function useDeletePerson() {
  const client = useQueryClient();
  const toast = useToast();
  const restore = useMutation({
    mutationFn: (id: string) => api.restorePerson(id),
    onSettled: () => invalidateEverywhere(client, AFTER_PERSON_CHANGE),
  });
  return useMutation({
    mutationFn: (person: Person) => api.deletePerson(person.id),
    onSuccess: (_void, person) => {
      toast.show({
        message: 'Person deleted',
        actionLabel: 'Undo',
        onAction: () => {
          restore.mutate(person.id);
        },
      });
    },
    onError: () => {
      toast.show({ message: "Couldn't save that change. It was undone.", tone: 'alert' });
    },
    onSettled: () => invalidateEverywhere(client, AFTER_PERSON_CHANGE),
  });
}
