import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ulid } from 'ulid';
import { LIMITS } from '@shared/constants';
import { EmptyState } from '../../components/ui/EmptyState';
import { CloseIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { ListSkeleton, LoadError } from '../../components/ui/Skeleton';
import { TagPicker } from '../journal/FilterBar';
import { TagList } from '../notes/NoteParts';
import { useCreatePerson, usePeople } from './hooks';
import { PipsInline } from './ProgressPips';
import { useTerms } from '../settings/useLayout';

/** `/people`: a plain list with one input to add someone by name. */
export function PeoplePage() {
  const terms = useTerms();
  const [params, setParams] = useSearchParams();
  const sort = params.get('sort') === 'updated' ? 'updated' : 'name';
  const tag = params.get('tag') ?? undefined;
  const people = usePeople({ tag, sort });
  const create = useCreatePerson();
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const all = people.data?.items ?? [];
  const needle = filter.trim().toLowerCase();
  const rows = needle ? all.filter((p) => p.name.toLowerCase().includes(needle)) : all;
  const typed = name.trim().toLowerCase();
  const existing = typed === '' ? undefined : all.find((p) => p.name.toLowerCase() === typed);

  const update = (next: { sort?: string | undefined; tag?: string | null }) => {
    const out = new URLSearchParams(params);
    if (next.sort !== undefined) {
      if (next.sort === 'updated') out.set('sort', 'updated');
      else out.delete('sort');
    }
    if (next.tag !== undefined) {
      if (next.tag === null) out.delete('tag');
      else out.set('tag', next.tag);
    }
    setParams(out, { replace: true });
  };

  const add = () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Add a name.');
      return;
    }
    if (trimmed.length > LIMITS.personName) {
      setError('Names can be up to 80 characters.');
      return;
    }
    setError(null);
    create.mutate(
      { id: ulid(), name: trimmed },
      {
        onSuccess: () => {
          setName('');
        },
        onError: (e) => {
          setError(e.message);
        },
      },
    );
  };

  return (
    <>
      <PageHeader title={terms.people.label} />
      <form
        className="mt-4 flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Add someone</span>
          <input
            value={name}
            aria-invalid={error ? true : undefined}
            aria-describedby="add-person-note"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            className="tap w-full rounded-control border border-ink-muted bg-paper px-3"
          />
        </label>
        <div id="add-person-note" className="text-sm">
          {error ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : null}
          {existing ? (
            <p role="status" className="text-ink-muted">
              Someone with this name already exists.{' '}
              <Link to={`/people/${existing.id}`}>Open them</Link>
            </p>
          ) : null}
        </div>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Filter people</span>
          <input
            value={filter}
            placeholder="Filter"
            onChange={(e) => {
              setFilter(e.target.value);
            }}
            className="tap w-44 rounded-control border border-ink-muted bg-paper px-2"
          />
        </label>
        <TagPicker
          selected={tag ? [tag] : []}
          onToggle={(t) => {
            update({ tag: tag?.toLowerCase() === t.toLowerCase() ? null : t });
          }}
        />
        {tag ? (
          <button
            type="button"
            className="tap inline-flex items-center gap-1 rounded-control border border-rule px-2 text-sm"
            aria-label={`Remove tag filter ${tag}`}
            onClick={() => {
              update({ tag: null });
            }}
          >
            #{tag} <CloseIcon />
          </button>
        ) : null}
        <button
          type="button"
          className="btn tap ml-auto text-sm"
          aria-pressed={sort === 'updated'}
          onClick={() => {
            update({ sort: sort === 'updated' ? 'name' : 'updated' });
          }}
        >
          {sort === 'updated' ? 'Recently updated' : 'A to Z'}
        </button>
      </div>

      {people.isError ? <LoadError onRetry={() => void people.refetch()} /> : null}
      <ListSkeleton pending={people.isPending} />
      {people.data && rows.length === 0 ? (
        all.length === 0 && !tag ? (
          <EmptyState>
            No {terms.people.many} yet. Add someone above, or type @ in a note.
          </EmptyState>
        ) : (
          <EmptyState>
            No one matches.{' '}
            <button
              type="button"
              className="tap underline"
              onClick={() => {
                setFilter('');
                update({ tag: null });
              }}
            >
              Clear filter
            </button>
          </EmptyState>
        )
      ) : null}
      {rows.length > 0 ? (
        <ul aria-label={terms.people.label} className="m-0 mt-2 list-none p-0">
          {rows.map((person) => (
            <li
              key={person.id}
              className="relative flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule py-2"
            >
              <span className="flex items-center gap-3">
                <Link
                  to={`/people/${person.id}`}
                  className="reading text-ink no-underline after:absolute after:inset-0 hover:underline"
                >
                  {person.name}
                </Link>
                {person.progressMax !== null ? (
                  <PipsInline value={person.progress ?? 0} max={person.progressMax} />
                ) : null}
              </span>
              <span className="relative z-10">
                <TagList tags={person.tags} to={(t) => `/people?tag=${encodeURIComponent(t)}`} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
