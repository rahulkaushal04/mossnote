import { useEffect, useRef } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { singleKey, useHotkeys } from '../../lib/hotkeys';
import { useNewNote } from '../../app/NewNote';
import { useCalendar } from '../calendar/CalendarProvider';
import { DayDateHeader } from '../calendar/DateHeader';
import { Composer } from '../capture/Composer';
import { DayNotes } from './DayNotes';

/** `/day/:key`: the same list for any day, with a composer stamped with that day. */
export function DayPage() {
  const { key } = useParams();
  const calendar = useCalendar();
  const navigate = useNavigate();
  const newNote = useNewNote();
  const area = useRef<HTMLTextAreaElement | null>(null);
  const parsed = key !== undefined && /^\d+$/.test(key) ? Number(key) : null;
  const valid = parsed !== null && calendar.isValid(parsed);

  useEffect(() => {
    newNote.registerInline(area);
    return () => {
      newNote.registerInline(null);
    };
  }, [newNote]);

  const step = (days: number) => {
    if (!valid) return;
    const target = calendar.advance(parsed, days);
    if (target !== null)
      void navigate(target === calendar.currentGameDate ? '/' : `/day/${target}`);
  };
  useHotkeys({
    '[': singleKey(() => {
      step(-1);
    }),
    ']': singleKey(() => {
      step(1);
    }),
  });

  if (!valid) {
    return (
      <>
        <PageHeader title="Day" />
        <EmptyState>
          That date isn&apos;t in your calendar. <Link to="/">Go to Today</Link>
        </EmptyState>
      </>
    );
  }
  // The current date is Today.
  if (parsed === calendar.currentGameDate) return <Navigate to="/" replace />;

  const label = calendar.format(parsed, { withYear: true }) ?? '';
  return (
    <>
      <PageHeader title={label} />
      <DayDateHeader dayKey={parsed} />
      <div className="mt-3">
        <Composer
          scope={`day:${parsed}`}
          defaultGameDate={parsed}
          focusOnMount
          textareaRef={area}
        />
      </div>
      <div className="mt-4">
        <DayNotes filters={{ gameDate: parsed }} empty="Nothing written for this day." />
      </div>
    </>
  );
}
