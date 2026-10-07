import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

export const useJournals = () =>
  useQuery({ queryKey: queryKeys.journals, queryFn: api.listJournals });

/** The journal list entry for the open journal, once the list has loaded. */
export function useActiveJournal() {
  const { data } = useJournals();
  return data?.items.find((journal) => journal.id === data.active);
}

/** A sentence for a failed journal request, in the words of the server where it has them. */
export function journalProblem(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
