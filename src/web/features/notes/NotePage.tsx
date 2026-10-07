import { Link, useParams } from 'react-router';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { ListSkeleton, LoadError } from '../../components/ui/Skeleton';
import { ApiError } from '../../lib/api';
import { NoteEntry } from './NoteEntry';
import { useNote } from './hooks';
import { LinkChip } from './NoteParts';
import { OnMaps } from '../maps/OnMaps';

/** `/notes/:id`: one note in full, with the notes that link here. */
export function NotePage() {
  const { id = '' } = useParams();
  const query = useNote(id);
  const gone =
    query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);

  return (
    <>
      <PageHeader title="Note" />
      <p className="py-2">
        <Link to="/journal">← Journal</Link>
      </p>
      <ListSkeleton pending={query.isPending} />
      {gone ? (
        <EmptyState>
          This note isn&apos;t here. It may have been deleted.{' '}
          <Link to="/settings#trash">Recently deleted</Link>
        </EmptyState>
      ) : query.isError ? (
        <LoadError onRetry={() => void query.refetch()} />
      ) : null}
      {query.data ? (
        <>
          <ul className="m-0 list-none p-0">
            <NoteEntry note={query.data} collapsible={false} />
          </ul>
          {query.data.linkedFrom.length > 0 ? (
            <section aria-labelledby="linked-from" className="mt-8">
              <h2
                id="linked-from"
                className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase"
              >
                Linked from
              </h2>
              <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                {query.data.linkedFrom.map((link) => (
                  <li key={link.id}>
                    <LinkChip link={link} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <OnMaps type="note" id={query.data.id} />
        </>
      ) : null}
    </>
  );
}
