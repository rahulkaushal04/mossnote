import {
  cloneElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEventHandler,
  type ReactElement,
} from 'react';
import { COUNTER_MAX, dayNumber, decode, encode, fromDayNumber } from '@shared/gameDate';
import { LIMITS } from '@shared/constants';
import { Dialog } from '../../components/ui/Dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/Popover';
import { useIsNarrow } from '../../lib/useViewport';
import { useCalendar } from './CalendarProvider';

export interface GameDatePickerProps {
  /** The date shown when the picker opens; null starts from the current date, or year 1. */
  value: number | null;
  /** Called with the confirmed date, or null for the clear action. */
  onChange: (key: number | null) => void;
  /** Label for the clear action, or undefined to hide it. */
  clearLabel?: string | undefined;
  /** Name of the dialog, for assistive technology. */
  title: string;
  /** The element that opens the picker. */
  children: ReactElement;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}

const COLUMNS = 7;

type BodyProps = Pick<GameDatePickerProps, 'value' | 'onChange' | 'clearLabel'> & {
  close: () => void;
};

/** A day counter has one thing to pick: which day. */
function CounterPickerBody({ value, onChange, clearLabel, close }: BodyProps) {
  const calendar = useCalendar();
  const seed = value ?? calendar.currentGameDate;
  const [day, setDay] = useState(seed !== null && calendar.isValid(seed) ? dayNumber(seed) : 1);
  const word = calendar.calendar.seasons[0]?.name ?? 'Day';

  const confirm = () => {
    const key = fromDayNumber(day);
    if (key === null) return;
    onChange(key);
    close();
  };

  return (
    <form
      role="group"
      aria-label="Pick a date"
      className="flex w-full flex-col gap-4 text-base"
      onSubmit={(event) => {
        event.preventDefault();
        confirm();
      }}
    >
      <div className="flex items-center gap-2">
        <label htmlFor="picker-day-number" className="font-semibold">
          {word}
        </label>
        <button
          type="button"
          className="btn tap"
          aria-label={`Previous ${word.toLowerCase()}`}
          disabled={day <= 1}
          onClick={() => {
            setDay((d) => Math.max(1, d - 1));
          }}
        >
          −
        </button>
        <input
          id="picker-day-number"
          type="number"
          inputMode="numeric"
          min={1}
          max={COUNTER_MAX}
          value={day}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the picker has this one field
          autoFocus
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 1 && n <= COUNTER_MAX) setDay(n);
          }}
          className="field-input w-28 text-center"
        />
        <button
          type="button"
          className="btn tap"
          aria-label={`Next ${word.toLowerCase()}`}
          disabled={day >= COUNTER_MAX}
          onClick={() => {
            setDay((d) => Math.min(COUNTER_MAX, d + 1));
          }}
        >
          +
        </button>
      </div>
      <p className="text-sm text-ink-muted">
        Type a number, or use the arrow keys. Enter confirms.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary tap">
          Set date
        </button>
        {clearLabel ? (
          <button
            type="button"
            className="btn tap"
            onClick={() => {
              onChange(null);
              close();
            }}
          >
            {clearLabel}
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function DatePickerBody(props: BodyProps) {
  const calendar = useCalendar();
  return calendar.calendar.counter ? (
    <CounterPickerBody {...props} />
  ) : (
    <SeasonPickerBody {...props} />
  );
}

function SeasonPickerBody({ value, onChange, clearLabel, close }: BodyProps) {
  const calendar = useCalendar();
  const start = useMemo(() => {
    const seed = value ?? calendar.currentGameDate ?? encode({ year: 1, season: 0, day: 1 });
    return calendar.isValid(seed) ? decode(seed) : { year: 1, season: 0, day: 1 };
  }, [value, calendar]);
  const [year, setYear] = useState(start.year);
  const [season, setSeason] = useState(start.season);
  const [day, setDay] = useState(start.day);
  const buffer = useRef('');
  const bufferTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const days = calendar.calendar.seasons[season]?.days ?? 1;
  const clampedDay = Math.min(day, days);

  const confirm = () => {
    onChange(encode({ year, season, day: clampedDay }));
    close();
  };

  const selectSeason = (index: number) => {
    setSeason(index);
    setDay((d) => Math.min(d, calendar.calendar.seasons[index]?.days ?? 1));
  };

  const focusDay = (target: number) => {
    const next = Math.min(Math.max(target, 1), days);
    setDay(next);
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus();
    });
  };

  /** Digits typed anywhere in the picker set the day. */
  const onDigit = (digit: string) => {
    clearTimeout(bufferTimer.current);
    let next = buffer.current + digit;
    if (Number(next) > days || Number(next) < 1) next = digit;
    buffer.current = next;
    bufferTimer.current = setTimeout(() => {
      buffer.current = '';
    }, 1000);
    if (Number(next) >= 1 && Number(next) <= days) setDay(Number(next));
  };

  useEffect(() => () => clearTimeout(bufferTimer.current), []);

  // Digits and Enter anywhere in the picker, bound natively so the wrapper stays a plain group.
  const onKeyDown = (event: globalThis.KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (
      /^\d$/.test(event.key) &&
      !(target instanceof HTMLInputElement && target.type === 'number')
    ) {
      event.preventDefault();
      onDigit(event.key);
    } else if (event.key === 'Enter' && target.tagName !== 'BUTTON') {
      event.preventDefault();
      confirm();
    }
  };

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('keydown', onKeyDown);
    };
  });

  const onGridKey = (event: KeyboardEvent<HTMLButtonElement>, current: number) => {
    const moves: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      ArrowUp: current - COLUMNS,
      ArrowDown: current + COLUMNS,
      Home: 1,
      End: days,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      focusDay(next);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      confirm();
    }
  };

  return (
    <div
      ref={bodyRef}
      role="group"
      aria-label="Pick a date"
      className="flex w-full flex-col gap-4 text-base"
    >
      <div className="flex items-center gap-2">
        <label htmlFor="picker-year" className="font-semibold">
          Year
        </label>
        <button
          type="button"
          className="btn tap"
          aria-label="Previous year"
          disabled={year <= 1}
          onClick={() => {
            setYear((y) => Math.max(1, y - 1));
          }}
        >
          −
        </button>
        <input
          id="picker-year"
          type="number"
          inputMode="numeric"
          min={1}
          max={LIMITS.yearMax}
          value={year}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 1 && n <= LIMITS.yearMax) setYear(n);
          }}
          className="field-input w-24 text-center"
        />
        <button
          type="button"
          className="btn tap"
          aria-label="Next year"
          disabled={year >= LIMITS.yearMax}
          onClick={() => {
            setYear((y) => Math.min(LIMITS.yearMax, y + 1));
          }}
        >
          +
        </button>
      </div>

      <fieldset className="border-0 p-0">
        <legend className="mb-1 font-semibold">Season</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {calendar.calendar.seasons.map((s, index) => (
            <label key={s.name} className="tap flex items-center gap-2">
              <input
                type="radio"
                name="picker-season"
                checked={season === index}
                onChange={() => {
                  selectSeason(index);
                }}
                className="size-4 accent-accent"
              />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <p id="picker-day-label" className="mb-1 font-semibold">
          Day
        </p>
        <div
          ref={gridRef}
          role="radiogroup"
          aria-labelledby="picker-day-label"
          className="grid grid-cols-7 gap-1"
        >
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={d === clampedDay}
              data-day={d}
              tabIndex={d === clampedDay ? 0 : -1}
              onClick={() => {
                setDay(d);
              }}
              onKeyDown={(e) => {
                onGridKey(e, d);
              }}
              className={`tap rounded-md text-center ${
                d === clampedDay ? 'bg-accent font-semibold text-accent-ink' : 'hover:bg-surface'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Type digits to set the day. Arrow keys move. Enter confirms.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary tap" onClick={confirm}>
          Set date
        </button>
        {clearLabel ? (
          <button
            type="button"
            className="btn tap"
            onClick={() => {
              onChange(null);
              close();
            }}
          >
            {clearLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Pick an in-game date: a popover on wide screens, a bottom sheet on narrow ones.
 * Keyboard operable throughout.
 */
export function GameDatePicker(props: GameDatePickerProps) {
  const narrow = useIsNarrow();
  const [internal, setInternal] = useState(false);
  const open = props.open ?? internal;
  const setOpen = (next: boolean) => {
    setInternal(next);
    props.onOpenChange?.(next);
  };
  const body = (
    <DatePickerBody
      value={props.value}
      onChange={props.onChange}
      clearLabel={props.clearLabel}
      close={() => {
        setOpen(false);
      }}
    />
  );

  if (narrow) {
    return (
      <>
        {cloneElement(props.children as ReactElement<{ onClick?: MouseEventHandler }>, {
          onClick: () => {
            setOpen(true);
          },
        })}
        <Dialog open={open} onOpenChange={setOpen} title={props.title} placement="bottom">
          {body}
        </Dialog>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{props.children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem]" aria-label={props.title}>
        {body}
      </PopoverContent>
    </Popover>
  );
}
