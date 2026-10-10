import { useId, useRef, useState } from 'react';
import { Outlet, useSearchParams } from 'react-router';
import { ulid } from 'ulid';
import { LIMITS } from '@shared/constants';
import type { Planting } from '@shared/types';
import { AddRow } from '../../components/ui/AddRow';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { RemovableChip } from '../../components/ui/Chip';
import { LeafArt } from '../../components/ui/art';
import { PageHeader } from '../../components/ui/PageHeader';
import { ListSkeleton, LoadError } from '../../components/ui/Skeleton';
import { useCalendar } from '../calendar/CalendarProvider';
import { FarmRow } from './FarmRow';
import { useCreatePlanting, usePlantings } from './hooks';
import { useTerms } from '../settings/useLayout';
import { a } from '@shared/text';

/** What each group of entries is called, and the mark that goes with it. */
const GROUP_MARK: Record<string, string> = {
  Growing: 'bg-accent',
  Done: 'border border-ink-muted',
  Noted: 'border border-dashed border-ink-muted',
};

function Group({
  title,
  items,
  askingId,
  onAsking,
}: {
  title: string;
  items: Planting[];
  askingId: string | null;
  onAsking: (id: string | null) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="mt-8">
      <h2 className="day-label flex items-center gap-2">
        <span aria-hidden="true" className={`size-2 rounded-full ${GROUP_MARK[title] ?? ''}`} />
        {title}
        <span className="tnum font-normal">{items.length}</span>
      </h2>
      <ul className="stagger m-0 list-none p-0">
        {items.map((entry) => (
          <FarmRow
            key={entry.id}
            entry={entry}
            asking={askingId === entry.id}
            setAsking={(open) => {
              onAsking(open ? entry.id : null);
            }}
          />
        ))}
      </ul>
    </section>
  );
}

/** `/farm`: add an entry by name, then Growing, Done and Noted. */
export function FarmPage() {
  const terms = useTerms();
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag') ?? undefined;
  const plantings = usePlantings({ tag });
  const create = useCreatePlanting();
  const calendar = useCalendar();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [askingId, setAskingId] = useState<string | null>(null);
  const listId = useId();
  const entryInput = useRef<HTMLInputElement>(null);

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
      <PageHeader
        title={terms.farm.label}
        intro="What you have planted, what is growing and what is done."
      />
      <AddRow
        id="add-entry"
        label="Add an entry"
        placeholder="Add an entry…"
        value={name}
        inputRef={entryInput}
        listId={listId}
        invalid={error !== null}
        busy={create.isPending}
        onChange={(next) => {
          setName(next);
          setError(null);
        }}
        onSubmit={add}
        note={
          <>
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
          </>
        }
      />

      {tag ? (
        <p className="mt-3">
          <RemovableChip
            label={`#${tag}`}
            removeLabel={`Remove tag filter ${tag}`}
            onRemove={() => {
              setParams({}, { replace: true });
            }}
          />
        </p>
      ) : null}

      {plantings.isError ? <LoadError onRetry={() => void plantings.refetch()} /> : null}
      <ListSkeleton pending={plantings.isPending} />
      {plantings.data && items.length === 0 ? (
        <EmptyState
          art={<LeafArt />}
          action={
            <Button
              variant="primary"
              onClick={() => {
                entryInput.current?.focus();
              }}
            >
              Add an entry
            </Button>
          }
        >
          Nothing here yet. Add {a(terms.farm.one === 'farm entry' ? 'entry' : terms.farm.one)} when
          you plant something.
        </EmptyState>
      ) : null}
      <Group title="Growing" items={growing} askingId={askingId} onAsking={setAskingId} />
      <Group title="Done" items={done} askingId={askingId} onAsking={setAskingId} />
      <Group title="Noted" items={noted} askingId={askingId} onAsking={setAskingId} />
      <Outlet />
    </>
  );
}
