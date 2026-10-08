import { useEffect, useRef } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { useLocalDay } from '../../lib/useLocalDay';
import { useNewNote } from '../../app/NewNote';
import { useCalendar } from '../calendar/CalendarProvider';
import { TodayDateHeader } from '../calendar/DateHeader';
import { Composer } from '../capture/Composer';
import { useSettings, useUpdateSettings } from '../settings/useSettings';
import { DayNotes } from './DayNotes';
import { TodaySections } from './TodaySections';

/** The real-date fallback hint: dismissible, and it stays dismissed. */
function SetDateHint() {
  const settings = useSettings();
  const update = useUpdateSettings();
  if (settings.data?.prefs.hintDismissed !== false) return null;
  return (
    <p className="mt-2 flex items-center gap-1 text-sm text-ink-muted" role="note">
      <span>Set the in-game date to group notes by game day.</span>
      <button
        type="button"
        className="btn btn-ghost shrink-0 whitespace-nowrap"
        onClick={() => {
          update.mutate({ prefs: { hintDismissed: true } });
        }}
      >
        Hide this tip
      </button>
    </p>
  );
}

/** Today (`/`): capture first, then this day's notes, then the optional sections. */
export function TodayPage() {
  const calendar = useCalendar();
  const day = useLocalDay();
  const newNote = useNewNote();
  const area = useRef<HTMLTextAreaElement | null>(null);
  const current = calendar.currentGameDate;

  useEffect(() => {
    newNote.registerInline(area);
    return () => {
      newNote.registerInline(null);
    };
  }, [newNote]);

  const start = new Date(day.start);
  const weekday = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(start);
  const date = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long' }).format(start);

  return (
    <>
      <PageHeader
        title="Today"
        display={
          <>
            <em>{weekday}</em> <span className="muted">{date}</span>
          </>
        }
        intro="Write it down while it is fresh."
      />
      <Composer scope="home" defaultGameDate={current} focusOnMount textareaRef={area} />
      <div className="mt-2">
        <TodayDateHeader />
        {current === null ? <SetDateHint /> : null}
      </div>
      <div className="mt-6">
        <DayNotes
          filters={
            current === null
              ? { createdFrom: day.start, createdTo: day.end }
              : { gameDate: current }
          }
          empty={
            current === null
              ? 'Nothing written today.'
              : 'Nothing written for this day. A quiet day is fine.'
          }
        />
      </div>
      <TodaySections />
    </>
  );
}
