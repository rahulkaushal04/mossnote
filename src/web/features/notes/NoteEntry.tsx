import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Note } from '@shared/types';
import { formatDateTime } from '../../lib/format';
import { useCalendar } from '../calendar/CalendarProvider';
import { ChipButton } from '../calendar/GameDateChip';
import { GameDatePicker } from '../calendar/GameDatePicker';
import { spokenDate } from '../calendar/dateLabels';
import { EditableNote } from './EditableNote';
import { useUpdateNoteOptimistic } from './hooks';
import { NoteBody } from './NoteBody';
import { NoteMenu } from './NoteMenu';
import { LinkChip, Marks, TagList } from './NoteParts';
import { QuestionControls } from './QuestionControls';

const COLLAPSE_LINES = 12;
const COLLAPSE_CHARS = 900;

/** The first words of a note, as its accessible name. */
const entryName = (note: Note): string => {
  const title = note.title?.trim();
  if (title) return title;
  return note.body.trim().replace(/\s+/g, ' ').slice(0, 60) || 'Note';
};

/**
 * One note as an entry, not a card: a gutter for the flag marks, an optional
 * serif title, the body, and a quiet metadata line. Clicking the body, or pressing `e` while the
 * entry is focused, edits it in place.
 */
export function NoteEntry({
  note,
  editable = true,
  collapsible = true,
  showAddDate = false,
  showDate = true,
}: {
  note: Note;
  editable?: boolean;
  /** Collapse long notes with "Show more" (lists), or show them in full (the note page). */
  collapsible?: boolean;
  /** Offer an "Add date" action, for the Journal's "Not dated" group. */
  showAddDate?: boolean;
  /**
   * Print the game date. A list that already says the day (a day heading, the Day page) turns this
   * off: the date stays a control for screen readers and the keyboard, and in the entry's menu.
   */
  showDate?: boolean;
}) {
  const calendar = useCalendar();
  const update = useUpdateNoteOptimistic();
  const [editing, setEditing] = useState<{ action?: 'title' | 'link' | undefined } | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const article = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const long = note.body.split('\n').length > COLLAPSE_LINES || note.body.length > COLLAPSE_CHARS;
  const clamp = collapsible && long && !expanded;

  const reading = editing === null;
  const refocus = useRef(false);

  useLayoutEffect(() => {
    if (!article.current) return;
    article.current.tabIndex = editable ? 0 : -1;
    if (reading && refocus.current) {
      refocus.current = false;
      article.current.focus();
    }
  }, [editable, reading]);

  // `e` edits the focused entry; a click on the text (not on a link) edits in place.
  useEffect(() => {
    const el = article.current;
    if (!el || !editable) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target !== el ||
        event.key !== 'e' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      setEditing({});
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
    };
  }, [editable, reading]);

  useEffect(() => {
    const el = body.current;
    if (!el || !editable) return;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a, button')) return;
      if (window.getSelection()?.toString()) return;
      setEditing({});
    };
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('click', onClick);
    };
  }, [editable, editing]);

  const setDate = (key: number | null) => {
    update.mutate({ note, optimistic: { ...note, gameDate: key }, patch: { gameDate: key } });
  };

  const marks = <Marks discovery={note.isDiscovery} question={note.question?.state ?? null} />;
  const dateLabel =
    note.gameDate === null ? null : calendar.format(note.gameDate, { withYear: true });

  if (editing) {
    return (
      <li className="entry border-b border-line">
        {marks}
        <div className="entry-edit min-w-0">
          <EditableNote
            note={note}
            initialAction={editing.action}
            defaultGameDate={calendar.currentGameDate}
            onDone={() => {
              refocus.current = true;
              setEditing(null);
            }}
          />
        </div>
      </li>
    );
  }

  return (
    <li className="group border-b border-line">
      <article ref={article} aria-label={entryName(note)} className="entry outline-offset-2">
        {marks}
        <div className="min-w-0">
          {note.title ? <h3 className="reading font-semibold">{note.title}</h3> : null}
          <div ref={body} className={editable ? 'cursor-text' : ''}>
            <NoteBody
              value={note.body}
              className={clamp ? 'line-clamp-[12] overflow-hidden' : ''}
            />
          </div>
          {collapsible && long ? (
            <button
              type="button"
              className="tap mt-1 text-sm underline"
              aria-expanded={expanded}
              onClick={() => {
                setExpanded((v) => !v);
              }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          ) : null}
          <QuestionControls note={note} />
        </div>
        <div
          className="entry-meta"
          // The date is not printed where its heading says it, so its tooltip moves to the margin.
          title={
            showDate || note.gameDate === null
              ? undefined
              : `Created ${formatDateTime(note.createdAt)}\nModified ${formatDateTime(note.updatedAt)}`
          }
        >
          <GameDatePicker
            value={note.gameDate}
            onChange={setDate}
            clearLabel="Clear date"
            title="Date of this note"
            open={dateOpen}
            onOpenChange={setDateOpen}
          >
            {note.gameDate !== null && dateLabel ? (
              <button
                type="button"
                aria-label={`${spokenDate(note.gameDate, calendar.calendar) ?? dateLabel}. Change date`}
                title={`Created ${formatDateTime(note.createdAt)}\nModified ${formatDateTime(note.updatedAt)}`}
                className={
                  showDate
                    ? 'tap tnum hover:underline'
                    : 'sr-only focus:not-sr-only focus:underline'
                }
              >
                {dateLabel}
              </button>
            ) : showAddDate ? (
              <ChipButton label="Add date" />
            ) : (
              <button type="button" className="sr-only focus:not-sr-only focus:underline">
                No date. Add date
              </button>
            )}
          </GameDatePicker>
          <TagList tags={note.tags} />
          {note.links.map((link) => (
            <LinkChip key={`${link.type}:${link.id}`} link={link} />
          ))}
          {editable ? (
            <span className="opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
              <NoteMenu
                note={note}
                onEdit={(action) => {
                  setEditing({ action });
                }}
                onSetDate={() => {
                  // Let the menu finish closing (and return focus) so the popover is not dismissed by it.
                  setTimeout(() => {
                    setDateOpen(true);
                  }, 0);
                }}
              />
            </span>
          ) : null}
        </div>
      </article>
    </li>
  );
}
