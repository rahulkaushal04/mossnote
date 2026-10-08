import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../components/ui/Toast';
import { api, ApiError } from '../../lib/api';
import { broadcastJournalSwitched } from '../../lib/broadcast';
import { showJournal } from '../../lib/journal';
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

/**
 * Switch to another journal. The app reloads on it, which keeps every screen, cache and draft
 * from mixing journals; a failure is shown as a toast.
 */
export function useSwitchJournal(): (id: string) => void {
  const toast = useToast();
  return (id) => {
    api
      .activateJournal(id)
      .then(() => {
        broadcastJournalSwitched(id);
        showJournal();
      })
      .catch((e: unknown) => {
        toast.show({ message: journalProblem(e, "Couldn't switch journals."), tone: 'alert' });
      });
  };
}
