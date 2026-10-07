import { EmptyState } from '../../components/ui/EmptyState';
import { ListSkeleton, LoadError } from '../../components/ui/Skeleton';
import type { NoteFilters } from '../../lib/api';
import { EntryList } from '../notes/EntryList';
import { useNotes } from '../notes/hooks';

/** The notes for one day, newest first. Loads every page of that day (a day is small). */
export function DayNotes({ filters, empty }: { filters: NoteFilters; empty: string }) {
  const query = useNotes({ ...filters, order: 'desc', limit: 50 });
  const notes = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (query.isError) return <LoadError onRetry={() => void query.refetch()} />;
  if (query.isPending) return <ListSkeleton pending />;
  if (notes.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <>
      <EntryList notes={notes} groupBy="none" label="Notes for this day" />
      {query.hasNextPage ? (
        <button type="button" className="btn tap mt-4" onClick={() => void query.fetchNextPage()}>
          Load more
        </button>
      ) : null}
    </>
  );
}
