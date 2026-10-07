import { useEffect, useRef } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { formatLocalDay } from '../../lib/format';
import { useLocalDay } from '../../lib/useLocalDay';
import { useNewNote } from '../../app/NewNote';
import { useCalendar } from '../calendar/CalendarProvider';
import { TodayDateHeader } from '../calendar/DateHeader';
import { Composer } from '../capture/Composer';
import { useSettings, useUpdateSettings } from '../settings/useSettings';
import { DayNotes } from './DayNotes';
import { TodaySections } from './TodaySections';

/** The real-date fallback hint: dismissible, and it stays dismissed (AC-DAY-5). */
function SetDateHint() {
  const settings = useSettings();
  const update = useUpdateSettings();
  if (settings.data?.prefs.hintDismissed !== false) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-muted" role="note">
      <span>Set the in-game date to group notes by game day.</span>
      <button
        type="button"
        className="tap underline"
        onClick={() => {
          update.mutate({ prefs: { hintDismissed: true } });
        }}
      >
        Dismiss
      </button>
    </p>
  );
}

/** Today (`/`): capture first, then this day's notes, then the optional sections (spec 5.4). */
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

  return (
    <>
      <PageHeader title="Today" />
      <TodayDateHeader />
      {current === null ? (
        <>
          <p className="text-sm text-ink-muted">{formatLocalDay(day.start)}</p>
          <SetDateHint />
        </>
      ) : null}
      <div className="mt-3">
        <Composer scope="home" defaultGameDate={current} focusOnMount textareaRef={area} />
      </div>
      <div className="mt-4">
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
