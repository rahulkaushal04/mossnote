import { useNavigate } from 'react-router';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/ui/icons';
import { Tip } from '../../components/ui/Tooltip';
import { useCalendar } from './CalendarProvider';
import { GameDateChip } from './GameDateChip';
import { useAdvanceDay } from './useAdvanceDay';
import { useSetCurrentDate } from './useCurrentDate';

const arrow = 'btn tap px-2 disabled:cursor-not-allowed disabled:opacity-50';

/** Today's header row: the current game date chip with Previous day and Next day. */
export function TodayDateHeader() {
  const calendar = useCalendar();
  const setDate = useSetCurrentDate();
  const day = useAdvanceDay();
  return (
    <div
      className="flex flex-wrap items-center gap-2 py-3"
      role="group"
      aria-label="Current in-game date"
    >
      <GameDateChip
        value={calendar.currentGameDate}
        onChange={(key) => {
          setDate.mutate(key);
        }}
        emptyLabel="Set date"
        clearLabel="Stop stamping new notes"
        title="Set the in-game date"
      />
      <Tip label={day.hasDate ? 'Previous day' : 'Set the in-game date first'} keys="d p">
        <button
          type="button"
          className={arrow}
          aria-label="Previous day"
          aria-keyshortcuts="d p"
          disabled={!day.canGoPrevious}
          onClick={day.previous}
        >
          <ChevronLeftIcon />
        </button>
      </Tip>
      <Tip label={day.hasDate ? 'Next day' : 'Set the in-game date first'} keys="d n">
        <button
          type="button"
          className={arrow}
          aria-label="Next day"
          aria-keyshortcuts="d n"
          disabled={!day.canGoNext}
          onClick={day.next}
        >
          <ChevronRightIcon />
        </button>
      </Tip>
    </div>
  );
}

/** The Day page's header row: jump to any day, and step through days with `[` and `]`. */
export function DayDateHeader({ dayKey }: { dayKey: number }) {
  const calendar = useCalendar();
  const navigate = useNavigate();
  const go = (key: number | null) => {
    if (key === null) return;
    void navigate(key === calendar.currentGameDate ? '/' : `/day/${key}`);
  };
  const previous = calendar.advance(dayKey, -1);
  const next = calendar.advance(dayKey, 1);
  return (
    <div
      className="flex flex-wrap items-center gap-2 py-3"
      role="group"
      aria-label="Viewed in-game day"
    >
      <GameDateChip value={dayKey} onChange={go} emptyLabel="Choose a day" title="Go to a day" />
      <Tip label="Previous day" keys="[">
        <button
          type="button"
          className={arrow}
          aria-label="Previous day"
          aria-keyshortcuts="["
          disabled={previous === null}
          onClick={() => {
            go(previous);
          }}
        >
          <ChevronLeftIcon />
        </button>
      </Tip>
      <Tip label="Next day" keys="]">
        <button
          type="button"
          className={arrow}
          aria-label="Next day"
          aria-keyshortcuts="]"
          disabled={next === null}
          onClick={() => {
            go(next);
          }}
        >
          <ChevronRightIcon />
        </button>
      </Tip>
    </div>
  );
}
