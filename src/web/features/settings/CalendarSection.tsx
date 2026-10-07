import { useState } from 'react';
import '../../lib/zodConfig';
import { DEFAULT_CALENDAR, LIMITS, type Calendar } from '@shared/constants';
import { calendarSchema } from '@shared/schemas/calendar';
import { CloseIcon } from '../../components/ui/icons';
import { ApiError } from '../../lib/api';
import { useCalendar } from '../calendar/CalendarProvider';
import { useUpdateSettings } from './useSettings';

interface Row {
  name: string;
  days: string;
}

const toRows = (calendar: Calendar): Row[] =>
  calendar.seasons.map((s) => ({ name: s.name, days: String(s.days) }));

/**
 * Settings → Game calendar (spec section 5.3): season names and day counts. Renaming only changes
 * labels. A change that would strand stored dates is refused with a count and nothing changes.
 */
export function CalendarSection() {
  const { calendar } = useCalendar();
  const update = useUpdateSettings();
  const [rows, setRows] = useState<Row[]>(() => toRows(calendar));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (index: number, patch: Partial<Row>) => {
    setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setSaved(false);
    setError(null);
  };

  const save = () => {
    const candidate = { seasons: rows.map((r) => ({ name: r.name, days: Number(r.days) })) };
    const parsed = calendarSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'That calendar is not valid.');
      return;
    }
    update.mutate(
      { calendar: parsed.data },
      {
        onSuccess: () => {
          setSaved(true);
          setError(null);
        },
        onError: (e) => {
          setError(e instanceof ApiError ? e.message : "Couldn't save the calendar.");
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-muted">
        Season names and the number of days in each. Renaming a season only changes how dates are
        written.
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <span className="sr-only">Season {index + 1} name</span>
              <input
                value={row.name}
                maxLength={LIMITS.seasonName}
                onChange={(e) => {
                  set(index, { name: e.target.value });
                }}
                className="tap w-44 rounded-control border border-ink-muted bg-paper px-2"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="sr-only">Season {index + 1} days</span>
              <input
                type="number"
                min={1}
                max={LIMITS.daysPerSeasonMax}
                value={row.days}
                onChange={(e) => {
                  set(index, { days: e.target.value });
                }}
                className="tap w-20 rounded-control border border-ink-muted bg-paper px-2"
              />
              <span className="text-sm text-ink-muted">days</span>
            </label>
            <button
              type="button"
              className="tap text-ink-muted hover:text-danger disabled:opacity-40"
              aria-label={`Remove ${row.name || `season ${index + 1}`}`}
              disabled={rows.length <= LIMITS.seasonsMin}
              onClick={() => {
                setRows((r) => r.filter((_, i) => i !== index));
                setSaved(false);
              }}
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn tap"
          disabled={rows.length >= LIMITS.seasonsMax}
          onClick={() => {
            setRows((r) => [...r, { name: '', days: '28' }]);
            setSaved(false);
          }}
        >
          Add season
        </button>
        <button
          type="button"
          className="btn tap"
          onClick={() => {
            setRows(toRows(DEFAULT_CALENDAR));
            setSaved(false);
            setError(null);
          }}
        >
          Reset to defaults
        </button>
        <button
          type="button"
          className="btn btn-primary tap"
          disabled={update.isPending}
          onClick={save}
        >
          Save calendar
        </button>
        <span role="status" aria-live="polite" className="text-sm text-ink-muted">
          {saved ? 'Saved' : ''}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
