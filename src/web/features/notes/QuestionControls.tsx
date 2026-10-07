import { useState } from 'react';
import type { Note } from '@shared/types';
import { useCalendar } from '../calendar/CalendarProvider';
import { CheckIcon } from '../../components/ui/icons';
import { useUpdateNoteOptimistic } from './hooks';

/**
 * Under a question: Mark solved with an optional answer in the user's own words, or the solved
 * state with Reopen (spec section 5.8). The app never suggests or looks up an answer.
 */
export function QuestionControls({ note }: { note: Note }) {
  const calendar = useCalendar();
  const update = useUpdateNoteOptimistic();
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState('');
  const question = note.question;
  if (!question) return null;

  const solve = (resolution: string) => {
    const text = resolution.trim();
    const optimistic: Note = {
      ...note,
      question: {
        state: 'solved',
        resolution: text === '' ? question.resolution : text,
        solvedGameDate: calendar.currentGameDate,
        solvedAt: new Date().toISOString(),
      },
    };
    update.mutate({
      note,
      optimistic,
      patch: { question: { state: 'solved', ...(text === '' ? {} : { resolution: text }) } },
    });
    setAsking(false);
    setAnswer('');
  };

  const reopen = () => {
    update.mutate({
      note,
      optimistic: {
        ...note,
        question: { ...question, state: 'open', solvedAt: null, solvedGameDate: null },
      },
      patch: { question: { state: 'open' } },
    });
  };

  if (question.state === 'solved') {
    const solvedOn =
      question.solvedGameDate === null
        ? null
        : calendar.format(question.solvedGameDate, { withYear: true });
    return (
      <div className="mt-2 text-sm text-ink-muted">
        <p className="flex flex-wrap items-center gap-2">
          <CheckIcon />
          <span>Solved{solvedOn ? ` ${solvedOn}` : ''}</span>
          <button type="button" className="tap underline" onClick={reopen}>
            Reopen
          </button>
        </p>
        {question.resolution ? (
          <p className="reading mt-1 whitespace-pre-line text-ink">{question.resolution}</p>
        ) : null}
      </div>
    );
  }

  const since = note.gameDate === null ? null : calendar.format(note.gameDate, { withYear: true });
  return (
    <div className="mt-2 text-sm text-ink-muted">
      {asking ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            solve(answer);
          }}
        >
          <label className="flex flex-wrap items-center gap-2">
            <span className="sr-only">What was the answer? (optional)</span>
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the field opens on the user's own click
              autoFocus
              value={answer}
              maxLength={2000}
              placeholder="What was the answer? (optional)"
              onChange={(e) => {
                setAnswer(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setAsking(false);
                }
              }}
              className="tap w-72 max-w-full rounded-control border border-ink-muted bg-paper px-2 text-ink"
            />
          </label>
          <button
            type="button"
            className="tap underline"
            onClick={() => {
              solve('');
            }}
          >
            Skip
          </button>
        </form>
      ) : (
        <p className="flex flex-wrap items-center gap-2">
          {since ? <span>open since {since}</span> : null}
          <button
            type="button"
            className="tap underline"
            onClick={() => {
              setAsking(true);
            }}
          >
            Mark solved
          </button>
        </p>
      )}
    </div>
  );
}
