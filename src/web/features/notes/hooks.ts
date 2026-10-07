import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { NoteCreate, NotePatch } from '@shared/schemas/note';
import type { Note, NoteDetail } from '@shared/types';
import { useToast } from '../../components/ui/Toast';
import { api, type NoteFilters } from '../../lib/api';
import { invalidateEverywhere } from '../../lib/broadcast';
import { queryKeys } from '../../lib/queryKeys';
import { insertNote, removeNote, replaceNote, restoreLists, snapshotLists } from './notesCache';

/** Everything a note change can affect: lists, counts, tags, search, backlinks, recently deleted. */
const AFTER_NOTE_CHANGE: readonly (readonly unknown[])[] = [
  ['notes'],
  ['note'],
  ['tags'],
  ['search'],
  ['pick'],
  ['trash'],
  ['person'],
  ['planting'],
];

export const refreshNotes = (client: QueryClient) =>
  invalidateEverywhere(client, AFTER_NOTE_CHANGE);

/** One page at a time; "Load more" and near-the-end loading fetch the next. */
export function useNotes(filters: NoteFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.notes(filters),
    queryFn: ({ pageParam }) =>
      api.listNotes({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useNotesCount(filters: NoteFilters) {
  return useQuery({
    queryKey: queryKeys.notesCount(filters),
    queryFn: () => api.countNotes(filters),
  });
}

export function useNote(id: string) {
  return useQuery<NoteDetail>({ queryKey: queryKeys.note(id), queryFn: () => api.getNote(id) });
}

/** Build the optimistic version of a note that is being created. */
export type CreateInput = NoteCreate & {
  id: string;
  /** Chip labels (`type:id` to text) so the optimistic note shows real names. */
  labels?: Record<string, string>;
};

/** Labels are only for the optimistic note; the server gets the plain request. */
function withoutLabels(input: CreateInput): NoteCreate {
  const copy: CreateInput = { ...input };
  delete copy.labels;
  return copy;
}

export function draftToNote(input: CreateInput, now: Date): Note {
  const q = input.question;
  return {
    id: input.id,
    title: input.title ?? null,
    body: input.body ?? '',
    gameDate: input.gameDate ?? null,
    isDiscovery: input.isDiscovery ?? false,
    question: q
      ? { state: q.state, resolution: q.resolution ?? null, solvedGameDate: null, solvedAt: null }
      : null,
    tags: input.tags ?? [],
    links: (input.links ?? []).map((l) => ({
      ...l,
      label: input.labels?.[`${l.type}:${l.id}`] ?? '…',
    })),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * Create a note. The note appears in every matching list at once (optimistic);
 * the client-generated id makes a retry after a failure safe.
 */
export function useCreateNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInput) => api.createNote(withoutLabels(input)),
    onMutate: (input) => {
      const snapshot = snapshotLists(client);
      insertNote(client, draftToNote(input, new Date()));
      return { snapshot };
    },
    onSuccess: (note) => {
      replaceNote(client, note);
    },
    onError: (_error, _input, context) => {
      if (context) restoreLists(client, context.snapshot);
    },
    onSettled: () => refreshNotes(client),
  });
}

/** Edit a note. Optimistic; rolls back on failure. A 409 is surfaced to the editor. */
export function useUpdateNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NotePatch }) => api.patchNote(id, patch),
    onSuccess: (note) => {
      replaceNote(client, note);
    },
    onSettled: () => refreshNotes(client),
  });
}

/** Toggle ✦ or ?, optimistic and undoable. */
export function useUpdateNoteOptimistic() {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ note, patch }: { note: Note; patch: NotePatch; optimistic: Note }) =>
      api.patchNote(note.id, patch),
    onMutate: ({ optimistic }) => {
      const snapshot = snapshotLists(client);
      replaceNote(client, optimistic);
      return { snapshot };
    },
    onSuccess: (saved) => {
      replaceNote(client, saved);
    },
    onError: (_error, _vars, context) => {
      if (context) restoreLists(client, context.snapshot);
      toast.show({ message: "Couldn't save that change. It was undone.", tone: 'alert' });
    },
    onSettled: () => refreshNotes(client),
  });
}

/** Delete with Undo: removed from every list at once, restored from the toast or Recently deleted. */
export function useDeleteNote() {
  const client = useQueryClient();
  const toast = useToast();
  const restore = useMutation({
    mutationFn: (id: string) => api.restoreNote(id),
    onSettled: () => refreshNotes(client),
  });
  return useMutation({
    mutationFn: (note: Note) => api.deleteNote(note.id),
    onMutate: (note) => {
      const snapshot = snapshotLists(client);
      removeNote(client, note.id);
      return { snapshot };
    },
    onSuccess: (_void, note) => {
      toast.show({
        message: 'Note deleted',
        actionLabel: 'Undo',
        onAction: () => {
          restore.mutate(note.id);
        },
      });
    },
    onError: (_error, _note, context) => {
      if (context) restoreLists(client, context.snapshot);
      toast.show({ message: "Couldn't save that change. It was undone.", tone: 'alert' });
    },
    onSettled: () => refreshNotes(client),
  });
}
