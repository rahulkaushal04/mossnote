import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { decode } from '@shared/gameDate';
import type { Note } from '@shared/types';
import { useCalendar } from '../calendar/CalendarProvider';
import { NoteEntry } from './NoteEntry';

/** Small capitals followed by a hairline: the one decorative gesture. */
function DayHeader({ children, to }: { children: string; to?: string }) {
  const label = (
    <span className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
      {children}
    </span>
  );
  return (
    <li className="flex items-center gap-3 pt-6" aria-hidden={to ? undefined : true}>
      {to ? (
        <Link to={to} className="no-underline hover:underline">
          {label}
        </Link>
      ) : (
        label
      )}
      <span className="h-px flex-1 bg-rule" aria-hidden="true" />
    </li>
  );
}

function YearHeader({ year }: { year: number }) {
  return (
    <li className="pt-8" aria-hidden="true">
      <span className="text-sm font-semibold tracking-[0.08em] uppercase">Year {year}</span>
    </li>
  );
}

/**
 * Notes grouped by in-game day with headers, in the order given. Notes
 * without a game date form a final "Not dated" group. With `groupBy="none"` it is a plain list.
 */
export function EntryList({
  notes,
  groupBy = 'day',
  label,
  showAddDate = false,
}: {
  notes: readonly Note[];
  groupBy?: 'day' | 'none';
  label: string;
  showAddDate?: boolean;
}) {
  const calendar = useCalendar();

  if (groupBy === 'none') {
    return (
      <ul aria-label={label} className="m-0 list-none p-0">
        {notes.map((note) => (
          <NoteEntry key={note.id} note={note} />
        ))}
      </ul>
    );
  }

  const rows: ReactNode[] = [];
  let lastKey: number | null | undefined;
  let lastYear: number | undefined;
  for (const note of notes) {
    const key = note.gameDate;
    if (key !== lastKey) {
      lastKey = key;
      if (key === null) {
        rows.push(<DayHeader key={`h-${note.id}`}>Not dated</DayHeader>);
      } else {
        const { year } = decode(key);
        // A day counter has no years to announce.
        if (!calendar.calendar.counter && lastYear !== undefined && lastYear !== year) {
          rows.push(<YearHeader key={`y-${note.id}`} year={year} />);
        }
        lastYear = year;
        rows.push(
          <DayHeader key={`h-${note.id}`} to={`/day/${key}`}>
            {calendar.format(key, { withYear: true }) ?? ''}
          </DayHeader>,
        );
      }
    }
    rows.push(<NoteEntry key={note.id} note={note} showAddDate={showAddDate && key === null} />);
  }
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      {rows}
    </ul>
  );
}
