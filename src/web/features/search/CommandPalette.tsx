import * as RadixDialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useOpenSetDate } from '../../app/SetDate';
import { modLabel } from '../../lib/hotkeys';
import type { MapHit, SearchHit } from '@shared/types';
import { Snippet } from '../../components/ui/Snippet';
import { useCalendar } from '../calendar/CalendarProvider';
import { useCommands } from './commands';
import { useRecentNotes, useSearch } from './hooks';
import { useTerms, useUsesSection } from '../settings/useLayout';
import { searchScope } from './scope';
import { sentence } from '@shared/text';

const ITEM =
  'tap flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-3 py-1.5 data-[selected=true]:bg-surface';
const HEADING =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-2';

export const hitPath = (hit: Pick<SearchHit, 'kind' | 'id' | 'title'>): string =>
  hit.kind === 'note'
    ? `/notes/${hit.id}`
    : hit.kind === 'person'
      ? `/people/${hit.id}`
      : hit.kind === 'planting'
        ? `/farm/${hit.id}`
        : `/journal?tag=${encodeURIComponent(hit.title.replaceAll('\u0001', '').replaceAll('\u0002', ''))}`;

export const mapHitPath = (hit: Pick<MapHit, 'mapId' | 'pinId'>): string =>
  hit.pinId ? `/maps/${hit.mapId}?pin=${hit.pinId}` : `/maps/${hit.mapId}`;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return debounced;
}

function HitItem({ hit, onOpen }: { hit: SearchHit; onOpen: () => void }) {
  const calendar = useCalendar();
  const date = hit.gameDate === null ? null : calendar.format(hit.gameDate, { withYear: true });
  return (
    <Command.Item value={`${hit.kind}:${hit.id}`} onSelect={onOpen} className={ITEM}>
      <span className="min-w-0">
        <span className="block truncate font-semibold">
          <Snippet text={hit.title} />
        </span>
        {hit.snippet ? (
          <span className="block truncate text-sm text-ink-muted">
            <Snippet text={hit.snippet} />
          </span>
        ) : null}
      </span>
      {date ? <span className="shrink-0 text-sm text-ink-muted">{date}</span> : null}
    </Command.Item>
  );
}

/**
 * Search and commands. `mod+K` anywhere. With nothing typed it lists commands
 * and the five most recently edited notes; typing shows grouped results, up to five per group.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const terms = useTerms();
  const usesFarm = useUsesSection('farm');
  const [text, setText] = useState('');
  const query = useDebounced(text, 80);
  const navigate = useNavigate();
  const openSetDate = useOpenSetDate();
  const opener = useRef<HTMLElement | null>(null);
  const searching = text.trim() !== '';
  const search = useSearch(query, { limit: 5, enabled: open });
  const recent = useRecentNotes(open && !searching);
  const commands = useCommands({ openDate: openSetDate });

  const close = () => {
    onOpenChange(false);
    setText('');
  };
  const go = (path: string) => {
    close();
    void navigate(path);
  };

  const groups = search.data?.groups;
  const shown = searching && query.trim() === text.trim() ? groups : searching ? groups : undefined;
  const total = shown
    ? shown.notes.length +
      shown.people.length +
      shown.plantings.length +
      shown.tags.length +
      shown.maps.length
    : 0;
  const needle = text.trim().toLowerCase();
  const matching = commands.filter((c) =>
    needle === '' ? true : `${c.label} ${c.keywords}`.toLowerCase().includes(needle),
  );

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setText('');
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <RadixDialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className="fixed inset-x-0 top-0 z-50 flex max-h-[60vh] flex-col overflow-hidden bg-raised text-ink wide:inset-auto wide:top-24 wide:left-1/2 wide:w-[560px] wide:-translate-x-1/2 wide:rounded-lg wide:shadow-2"
        >
          <RadixDialog.Title className="sr-only">Search and commands</RadixDialog.Title>
          <Command
            shouldFilter={false}
            loop
            label="Search and commands"
            className="flex min-h-0 flex-1 flex-col"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && searching) {
                event.preventDefault();
                go(`/search?q=${encodeURIComponent(text.trim())}`);
              }
            }}
          >
            <Command.Input
              value={text}
              onValueChange={setText}
              placeholder={`Search ${searchScope(terms, usesFarm)}…`}
              aria-label="Search"
              className="tap w-full border-0 border-b border-line bg-transparent px-4 py-3 outline-none placeholder:text-ink-muted"
            />
            <Command.List className={`min-h-0 flex-1 overflow-y-auto p-2 ${HEADING}`}>
              <p role="status" aria-live="polite" className="sr-only">
                {searching ? `${total} ${total === 1 ? 'result' : 'results'}` : ''}
              </p>

              {search.isError && searching ? (
                <p role="alert" className="px-3 py-3">
                  Search isn&apos;t available right now.{' '}
                  <button
                    type="button"
                    className="tap underline"
                    onClick={() => void search.refetch()}
                  >
                    Retry
                  </button>
                </p>
              ) : null}

              {searching && shown && total === 0 && !search.isFetching ? (
                <Command.Empty className="px-3 py-3 text-ink-muted">
                  No matches for ‘{text.trim()}’. Search covers {searchScope(terms, usesFarm)}.
                </Command.Empty>
              ) : null}

              {shown && shown.notes.length > 0 ? (
                <Command.Group heading={search.data?.partial ? 'Partial matches: notes' : 'Notes'}>
                  {shown.notes.map((hit) => (
                    <HitItem
                      key={hit.id}
                      hit={hit}
                      onOpen={() => {
                        go(hitPath(hit));
                      }}
                    />
                  ))}
                </Command.Group>
              ) : null}
              {shown && shown.people.length > 0 ? (
                <Command.Group heading={terms.people.label}>
                  {shown.people.map((hit) => (
                    <HitItem
                      key={hit.id}
                      hit={hit}
                      onOpen={() => {
                        go(hitPath(hit));
                      }}
                    />
                  ))}
                </Command.Group>
              ) : null}
              {shown && shown.plantings.length > 0 ? (
                <Command.Group heading={sentence(terms.farm.many)}>
                  {shown.plantings.map((hit) => (
                    <HitItem
                      key={hit.id}
                      hit={hit}
                      onOpen={() => {
                        go(hitPath(hit));
                      }}
                    />
                  ))}
                </Command.Group>
              ) : null}
              {shown && shown.tags.length > 0 ? (
                <Command.Group heading="Tags">
                  {shown.tags.map((hit) => (
                    <HitItem
                      key={hit.id}
                      hit={{ ...hit, title: `#${hit.title}`, snippet: null }}
                      onOpen={() => {
                        go(hitPath(hit));
                      }}
                    />
                  ))}
                </Command.Group>
              ) : null}

              {shown && shown.maps.length > 0 ? (
                <Command.Group heading="Maps">
                  {shown.maps.map((hit) => (
                    <Command.Item
                      key={`${hit.mapId}:${hit.pinId ?? ''}`}
                      value={`map:${hit.mapId}:${hit.pinId ?? ''}`}
                      className={ITEM}
                      onSelect={() => {
                        go(mapHitPath(hit));
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{hit.title}</span>
                        {hit.snippet ? (
                          <span className="block truncate text-sm text-ink-muted">
                            {hit.snippet}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-sm text-ink-muted">
                        {hit.pinId ? hit.mapName : 'Map'}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              {matching.length > 0 ? (
                <Command.Group heading="Commands">
                  {matching.map((command) => (
                    <Command.Item
                      key={command.id}
                      value={`command:${command.id}`}
                      className={ITEM}
                      onSelect={() => {
                        close();
                        // Let the palette close and return focus before the command moves it.
                        setTimeout(command.run, 0);
                      }}
                    >
                      <span>{command.label}</span>
                      {command.hint ? (
                        <span className="text-sm text-ink-muted">{command.hint}</span>
                      ) : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              {!searching && recent.data && recent.data.items.length > 0 ? (
                <Command.Group heading="Recent notes">
                  {recent.data.items.slice(0, 5).map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`recent:${item.id}`}
                      className={ITEM}
                      onSelect={() => {
                        go(`/notes/${item.id}`);
                      }}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.detail ? (
                        <span className="shrink-0 text-sm text-ink-muted">{item.detail}</span>
                      ) : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
            <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">
              ↑↓ to move · ↵ to open · {modLabel()}↵ for all results · Esc to close
            </p>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
