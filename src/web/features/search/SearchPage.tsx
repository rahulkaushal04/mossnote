import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { parseSearch, removeChip } from '@shared/searchQuery';
import type { MapHit, SearchHit } from '@shared/types';
import { CloseIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/Popover';
import { LoadError, ListSkeleton } from '../../components/ui/Skeleton';
import { Snippet } from '../../components/ui/Snippet';
import { useCalendar } from '../calendar/CalendarProvider';
import { hitPath, mapHitPath } from './CommandPalette';
import { useSearch } from './hooks';
import { useTerms, useUsesSection } from '../settings/useLayout';
import { searchScope } from './scope';
import { sentence } from '@shared/text';

function Group({ title, hits }: { title: string; hits: SearchHit[] }) {
  const calendar = useCalendar();
  if (hits.length === 0) return null;
  return (
    <section aria-label={title} className="mt-6">
      <h2 className="text-sm font-semibold text-ink-2">{title}</h2>
      <ul className="m-0 mt-2 list-none p-0">
        {hits.map((hit) => (
          <li key={`${hit.kind}:${hit.id}`} className="border-b border-line py-3">
            <Link to={hitPath(hit)} className="block text-ink no-underline hover:underline">
              <span className="reading font-semibold">
                <Snippet text={hit.kind === 'tag' ? `#${hit.title}` : hit.title} />
              </span>
              {hit.snippet ? (
                <span className="mt-1 block text-sm text-ink-muted">
                  <Snippet text={hit.snippet} />
                </span>
              ) : null}
            </Link>
            {hit.gameDate !== null ? (
              <p className="mt-1 text-sm text-ink-muted">
                {calendar.format(hit.gameDate, { withYear: true })}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MapGroup({ hits }: { hits: MapHit[] }) {
  if (hits.length === 0) return null;
  return (
    <section aria-label="Maps" className="mt-6">
      <h2 className="text-sm font-semibold text-ink-2">Maps</h2>
      <ul className="m-0 mt-2 list-none p-0">
        {hits.map((hit) => (
          <li key={`${hit.mapId}:${hit.pinId ?? ''}`} className="border-b border-line py-3">
            <Link to={mapHitPath(hit)} className="block text-ink no-underline hover:underline">
              <span className="reading font-semibold">{hit.title}</span>
              <span className="ml-2 text-sm text-ink-muted">
                {hit.pinId ? `Pin on ${hit.mapName}` : 'Map'}
              </span>
              {hit.snippet ? (
                <span className="mt-1 block text-sm text-ink-muted">{hit.snippet}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function tips(withFarm: boolean, counter: boolean): [string, string][] {
  return [
    ['harbour lantern', 'Every word must match, in any order'],
    ['"quiet corner"', 'An exact phrase'],
    ['-draft', 'Leave out a word'],
    ['#idea', 'Has the tag'],
    ['@Name', 'Notes that link to that person'],
    ['is:discovery  is:question', 'Flags'],
    ['is:open  is:solved', 'Question state'],
    [`in:notes  in:people${withFarm ? '  in:farm' : ''}`, 'Only one kind of result'],
    counter
      ? ['day 120', 'One in-game day']
      : ['spring 3  y2 summer', 'An in-game date; the year is optional'],
  ];
}

function Tips() {
  const withFarm = useUsesSection('farm');
  const counter = useCalendar().calendar.counter === true;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="btn tap text-sm">
          Search tips
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <dl className="m-0 flex flex-col gap-2 text-sm">
          {tips(withFarm, counter).map(([example, meaning]) => (
            <div key={example}>
              <dt className="font-semibold">
                <code>{example}</code>
              </dt>
              <dd className="m-0 text-ink-muted">{meaning}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** `/search?q=`: the full results, with removable chips for recognised tokens. */
export default function SearchPage() {
  const terms = useTerms();
  const usesFarm = useUsesSection('farm');
  const [params, setParams] = useSearchParams();
  const calendar = useCalendar();
  const q = (params.get('q') ?? '').slice(0, 200);
  const [text, setText] = useState(q);
  const search = useSearch(q, { limit: 50 });
  const parsed = parseSearch(q, calendar.calendar);

  // Keep the box in step when the URL changes (Back, a chip removed): adjust during render,
  // not in an effect.
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setText(q);
  }

  const setQuery = (next: string) => {
    setParams(next.trim() === '' ? {} : { q: next }, { replace: true });
  };

  const groups = search.data?.groups;
  const total = groups
    ? groups.notes.length +
      groups.people.length +
      groups.plantings.length +
      groups.tags.length +
      groups.maps.length
    : 0;
  let body: ReactNode = null;
  if (q.trim() !== '') {
    if (search.isError) body = <LoadError onRetry={() => void search.refetch()} />;
    else if (search.isPending) body = <ListSkeleton pending />;
    else if (total === 0) {
      body = (
        <p className="py-8 text-ink-muted">
          No matches for ‘{q.trim()}’. Search covers {searchScope(terms, usesFarm)}.
        </p>
      );
    } else if (groups) {
      body = (
        <>
          {search.data.partial ? (
            <p className="mt-4 text-sm text-ink-muted">Partial matches</p>
          ) : null}
          <Group title="Notes" hits={groups.notes} />
          <Group title={terms.people.label} hits={groups.people} />
          {usesFarm ? <Group title={sentence(terms.farm.many)} hits={groups.plantings} /> : null}
          <Group title="Tags" hits={groups.tags} />
          <MapGroup hits={groups.maps} />
        </>
      );
    }
  }

  return (
    <>
      <PageHeader title="Search" />
      <form
        role="search"
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(text);
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Search</span>
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            onBlur={() => {
              if (text !== q) setQuery(text);
            }}
            className="field-input w-full text-lg"
          />
        </label>
        <Tips />
      </form>
      {parsed.chips.length > 0 ? (
        <ul
          className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0"
          aria-label="Filters in this search"
        >
          {parsed.chips.map((chip) => (
            <li key={`${chip.type}:${chip.label}`}>
              <button
                type="button"
                className="tap inline-flex items-center gap-1 rounded-md border border-line px-2 text-sm"
                aria-label={`Remove ${chip.label}`}
                onClick={() => {
                  setQuery(removeChip(q, chip));
                }}
              >
                {chip.label} <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {body}
    </>
  );
}
