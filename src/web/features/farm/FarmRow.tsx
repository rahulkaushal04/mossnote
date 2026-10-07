import { useState } from 'react';
import { Link } from 'react-router';
import { ulid } from 'ulid';
import { decode } from '@shared/gameDate';
import type { Planting } from '@shared/types';
import { TagList } from '../notes/NoteParts';
import { useCalendar } from '../calendar/CalendarProvider';
import { GameDatePicker } from '../calendar/GameDatePicker';
import { useCreatePlanting, useUpdatePlanting } from './hooks';

const ACTION = 'tap rounded-control px-2 text-sm underline';
// Revealed on hover and focus; always shown where there is no hover (touch).
const REVEAL =
  'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100';

/** `Spring 3 → Summer 1`, with the year shown when it differs from the current one. */
export function useDateText() {
  const calendar = useCalendar();
  const currentYear =
    calendar.currentGameDate === null ? null : decode(calendar.currentGameDate).year;
  return (key: number): string => {
    const withYear = currentYear === null || decode(key).year !== currentYear;
    return calendar.format(key, { withYear }) ?? '';
  };
}

/** One farm entry as a light line: name, dates, counts, and a quick action on hover or focus. */
export function FarmRow({ entry }: { entry: Planting }) {
  const calendar = useCalendar();
  const text = useDateText();
  const update = useUpdatePlanting();
  const create = useCreatePlanting();
  const [asking, setAsking] = useState(false);
  const [count, setCount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const status =
    entry.harvestedOn !== null ? 'done' : entry.plantedOn !== null ? 'growing' : 'noted';

  const harvest = (key: number) => {
    if (entry.plantedOn !== null && key < entry.plantedOn) {
      setError("Harvest can't be before planting.");
      return;
    }
    setError(null);
    update.mutate(
      { id: entry.id, patch: { harvestedOn: key } },
      {
        onSuccess: () => {
          setAsking(true);
        },
        onError: (e) => {
          setError(e.message);
        },
      },
    );
  };

  const saveCount = () => {
    setAsking(false);
    const trimmed = count.trim();
    if (trimmed === '') return;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0 || n > 999_999) {
      setError('Use a whole number from 0 to 999,999.');
      setAsking(true);
      return;
    }
    update.mutate({ id: entry.id, patch: { harvestedCount: n } });
    setCount('');
  };

  const range = [
    entry.plantedOn === null ? null : text(entry.plantedOn),
    entry.harvestedOn === null ? null : text(entry.harvestedOn),
  ];
  const counts = [
    entry.plantedCount === null ? null : `planted ${entry.plantedCount}`,
    entry.harvestedCount === null ? null : `harvested ${entry.harvestedCount}`,
  ].filter(Boolean);

  return (
    <li className="group relative border-b border-rule py-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Link
          to={`/farm/${entry.id}`}
          className="reading text-ink no-underline after:absolute after:inset-0 hover:underline"
        >
          {entry.label}
        </Link>
        {range[0] || range[1] ? (
          <span className="text-sm text-ink-muted">
            {range[0] ?? '…'}
            {range[1] ? ` → ${range[1]}` : status === 'growing' ? ' →' : ''}
          </span>
        ) : null}
        {counts.length > 0 ? (
          <span className="text-sm text-ink-muted">{counts.join(' · ')}</span>
        ) : null}
        <span className="relative z-10 ml-auto flex items-center gap-1">
          <TagList tags={entry.tags} to={(t) => `/farm?tag=${encodeURIComponent(t)}`} />
          <span className={REVEAL}>
            {status === 'growing' ? (
              calendar.currentGameDate === null ? (
                <GameDatePicker
                  value={null}
                  onChange={(k) => {
                    if (k !== null) harvest(k);
                  }}
                  title="Harvest date"
                >
                  <button type="button" className={ACTION}>
                    Harvested today
                  </button>
                </GameDatePicker>
              ) : (
                <button
                  type="button"
                  className={ACTION}
                  onClick={() => {
                    if (calendar.currentGameDate !== null) harvest(calendar.currentGameDate);
                  }}
                >
                  Harvested today
                </button>
              )
            ) : null}
            {status === 'done' ? (
              <button
                type="button"
                className={ACTION}
                onClick={() => {
                  create.mutate({
                    id: ulid(),
                    label: entry.label,
                    tags: entry.tags,
                    ...(calendar.currentGameDate === null
                      ? {}
                      : { plantedOn: calendar.currentGameDate }),
                  });
                }}
              >
                Plant again
              </button>
            ) : null}
          </span>
        </span>
      </div>
      {asking ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveCount();
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <span>Harvested count</span>
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus -- opens right after the user's own click
              autoFocus
              inputMode="numeric"
              value={count}
              onChange={(e) => {
                setCount(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAsking(false);
              }}
              className="tap w-28 rounded-control border border-ink-muted bg-paper px-2"
            />
          </label>
          <button type="submit" className="btn tap text-sm">
            Save
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}
