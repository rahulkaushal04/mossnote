import { useEffect, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { JournalIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { ListSkeleton, LoadError } from '../../components/ui/Skeleton';
import { plural } from '../../lib/format';
import { useNewNote } from '../../app/NewNote';
import { EntryList } from '../notes/EntryList';
import { useNotes, useNotesCount } from '../notes/hooks';
import { FilterBar } from './FilterBar';
import { useJournalFilters } from './useJournalFilters';
import { useTerms } from '../settings/useLayout';

/** Copy for a filtered list that is empty. */
function emptyCopy(flag: string, state: string): string | null {
  if (flag === 'discovery')
    return 'No discoveries yet. Mark a note with ✦ and it will show up here.';
  if (flag === 'question' && state === 'open') return 'No open questions.';
  if (flag === 'question' && state === 'solved') return 'No solved questions yet.';
  return null;
}

/** `/journal`: everything in game-time order, narrowed by flag, tag and "Not dated". */
export function JournalPage() {
  const terms = useTerms();
  const { filters, query, update, clear } = useJournalFilters();
  const notes = useNotes(query);
  const count = useNotesCount({ ...query, order: undefined, limit: undefined });
  const everything = useNotesCount({});
  const newNote = useNewNote();
  const sentinel = useRef<HTMLDivElement>(null);

  const list = notes.data?.pages.flatMap((p) => p.items) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = notes;

  // Load the next page automatically near the end of the list.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const total = everything.data?.count;
  let empty: React.ReactNode = null;
  if (!notes.isPending && !notes.isError && list.length === 0) {
    if (total === 0) {
      empty = (
        <EmptyState
          icon={<JournalIcon />}
          action={
            <Button
              variant="primary"
              onClick={() => {
                newNote.requestNewNote();
              }}
            >
              Write a note
            </Button>
          }
        >
          Your journal starts with your first note.
        </EmptyState>
      );
    } else {
      const specific =
        filters.tags.length === 0 && !filters.undated
          ? emptyCopy(filters.flag, filters.state)
          : null;
      empty = specific ? (
        <EmptyState>{specific}</EmptyState>
      ) : (
        <EmptyState>
          Nothing matches these filters.{' '}
          <button type="button" className="btn btn-ghost underline" onClick={clear}>
            Clear filters
          </button>
        </EmptyState>
      );
    }
  }

  return (
    <>
      <PageHeader
        title={terms.journal.label}
        accent
        intro="Every note you've written, grouped by day."
      />
      <FilterBar filters={filters} onChange={update} />
      {count.data ? (
        <p className="tnum text-sm text-ink-muted" aria-live="polite">
          {plural(count.data.count, 'note')}
        </p>
      ) : null}
      {notes.isError ? <LoadError onRetry={() => void notes.refetch()} /> : null}
      <ListSkeleton pending={notes.isPending} />
      {empty}
      {list.length > 0 ? <EntryList notes={list} label="Journal entries" showAddDate /> : null}
      {hasNextPage ? (
        <>
          <div ref={sentinel} aria-hidden="true" />
          <button
            type="button"
            className="btn tap mt-4"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            Load more
          </button>
        </>
      ) : null}
    </>
  );
}
