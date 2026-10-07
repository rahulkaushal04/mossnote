import { useId, useState } from 'react';
import { Outlet, useSearchParams } from 'react-router';
import { ulid } from 'ulid';
import { LIMITS } from '@shared/constants';
import type { Planting } from '@shared/types';
import { EmptyState } from '../../components/ui/EmptyState';
import { CloseIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { ListSkeleton, LoadError } from '../../components/ui/Skeleton';
import { useCalendar } from '../calendar/CalendarProvider';
import { FarmRow } from './FarmRow';
import { useCreatePlanting, usePlantings } from './hooks';
import { useTerms } from '../settings/useLayout';
import { a } from '@shared/text';

function Group({ title, items }: { title: string; items: Planting[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="mt-8">
      <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">{title}</h2>
      <ul className="m-0 mt-1 list-none p-0">
        {items.map((entry) => (
          <FarmRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

/** `/farm`: add an entry by name, then Growing, Done and Noted (spec section 5.11). */
export function FarmPage() {
  const terms = useTerms();
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag') ?? undefined;
  const plantings = usePlantings({ tag });
  const create = useCreatePlanting();
  const calendar = useCalendar();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  const items = plantings.data?.items ?? [];
  const growing = items.filter((p) => p.plantedOn !== null && p.harvestedOn === null);
  const done = items.filter((p) => p.harvestedOn !== null);
  const noted = items.filter((p) => p.plantedOn === null && p.harvestedOn === null);
  const earlier = [...new Set(items.map((p) => p.label))].slice(0, 50);

  const add = () => {
    const label = name.trim();
    if (label === '') {
      setError('Add a name.');
      return;
    }
    if (label.length > LIMITS.plantingLabel) {
      setError('Names can be up to 80 characters.');
      return;
    }
    setError(null);
    create.mutate(
      {
        id: ulid(),
        label,
        ...(calendar.currentGameDate === null ? {} : { plantedOn: calendar.currentGameDate }),
      },
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
      <PageHeader title={terms.farm.label} />
      <form
        className="mt-4 flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Add an entry</span>
          <input
            list={listId}
            value={name}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            className="tap w-full rounded-control border border-ink-muted bg-paper px-3"
          />
        </label>
        <datalist id={listId}>
          {earlier.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>

      {tag ? (
        <p className="mt-3">
          <button
            type="button"
            className="tap inline-flex items-center gap-1 rounded-control border border-rule px-2 text-sm"
            aria-label={`Remove tag filter ${tag}`}
            onClick={() => {
              setParams({}, { replace: true });
            }}
          >
            #{tag} <CloseIcon />
          </button>
        </p>
      ) : null}

      {plantings.isError ? <LoadError onRetry={() => void plantings.refetch()} /> : null}
      <ListSkeleton pending={plantings.isPending} />
      {plantings.data && items.length === 0 ? (
        <EmptyState>
          Nothing here yet. Add {a(terms.farm.one === 'farm entry' ? 'entry' : terms.farm.one)} when
          you plant something.
        </EmptyState>
      ) : null}
      <Group title="Growing" items={growing} />
      <Group title="Done" items={done} />
      <Group title="Noted" items={noted} />
      <Outlet />
    </>
  );
}
