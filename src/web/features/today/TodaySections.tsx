import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { plural } from '../../lib/format';
import { useCalendar } from '../calendar/CalendarProvider';
import { useNotes, useNotesCount } from '../notes/hooks';
import { NoteBody } from '../notes/NoteBody';
import { useTerms, useUsesSection } from '../settings/useLayout';

const SECTION = 'text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted';

/** The three most recent ✦ notes of any date. Absent from the page when there are none. */
function RecentDiscoveries() {
  const calendar = useCalendar();
  const query = useNotes({ flag: 'discovery', order: 'desc', limit: 3 });
  const notes = query.data?.pages[0]?.items ?? [];
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="recent-discoveries" className="mt-10">
      <h2 id="recent-discoveries" className={SECTION}>
        Recent discoveries
      </h2>
      <ul className="m-0 mt-2 list-none p-0">
        {notes.map((note) => (
          <li key={note.id} className="border-b border-rule py-3">
            <Link to={`/notes/${note.id}`} className="block text-ink no-underline hover:underline">
              {note.title ? <span className="reading font-semibold">{note.title}</span> : null}
              <div className="line-clamp-2 overflow-hidden">
                <NoteBody value={note.body} />
              </div>
            </Link>
            {note.gameDate !== null ? (
              <p className="mt-1 text-sm text-ink-muted">
                {calendar.format(note.gameDate, { withYear: true })}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Up to three farm entries that are planted and not harvested. */
function Growing() {
  const terms = useTerms();
  const calendar = useCalendar();
  const query = useQuery({
    queryKey: queryKeys.plantings({ status: 'growing' }),
    queryFn: () => api.listPlantings({ status: 'growing' }),
  });
  const items = (query.data?.items ?? []).slice(0, 3);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="growing" className="mt-10">
      <h2 id="growing" className={SECTION}>
        Growing
      </h2>
      <ul className="m-0 mt-2 list-none p-0">
        {items.map((entry) => (
          <li
            key={entry.id}
            className="flex items-baseline justify-between gap-3 border-b border-rule py-2"
          >
            <Link to={`/farm/${entry.id}`}>{entry.label}</Link>
            {entry.plantedOn !== null ? (
              <span className="text-sm text-ink-muted">
                planted {calendar.format(entry.plantedOn, { withYear: true })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm">
        <Link to="/farm">{terms.farm.label}</Link>
      </p>
    </section>
  );
}

function OpenQuestions() {
  const count = useNotesCount({ flag: 'question', state: 'open' });
  const n = count.data?.count ?? 0;
  if (n === 0) return null;
  return (
    <p className="mt-10 text-sm text-ink-muted">
      <Link to="/journal?flag=question&state=open">{plural(n, 'open question')}</Link>
    </p>
  );
}

/** Today's optional sections. Each is removed from the page when empty, with no placeholder. */
export function TodaySections() {
  const usesFarm = useUsesSection('farm');
  return (
    <>
      <RecentDiscoveries />
      {usesFarm ? <Growing /> : null}
      <OpenQuestions />
    </>
  );
}
