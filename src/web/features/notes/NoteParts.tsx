import { Link } from 'react-router';
import type { LinkRef } from '@shared/types';
import { ArrowUpRightIcon, CheckIcon, CloseIcon, SparkIcon } from '../../components/ui/icons';

export const linkPath = (ref: Pick<LinkRef, 'type' | 'id'>): string =>
  ref.type === 'person'
    ? `/people/${ref.id}`
    : ref.type === 'planting'
      ? `/farm/${ref.id}`
      : `/notes/${ref.id}`;

/** One `↗ Label` chip. With `onRemove`, Backspace or Delete (or ×) removes it. */
export function LinkChip({ link, onRemove }: { link: LinkRef; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-sm">
      <Link
        to={linkPath(link)}
        className="tap inline-flex items-center gap-1 text-ink-muted hover:text-accent"
        onKeyDown={(event) => {
          if (onRemove && (event.key === 'Backspace' || event.key === 'Delete')) {
            event.preventDefault();
            onRemove();
          }
        }}
      >
        <ArrowUpRightIcon />
        <span>{link.label}</span>
      </Link>
      {onRemove ? (
        <button
          type="button"
          className="tap text-ink-muted hover:text-danger"
          aria-label={`Remove link to ${link.label}`}
          onClick={onRemove}
        >
          <CloseIcon />
        </button>
      ) : null}
    </span>
  );
}

/** Tags are quiet `#name` text, each a link that filters. */
export function TagList({
  tags,
  to = (tag) => `/journal?tag=${encodeURIComponent(tag)}`,
  onRemove,
}: {
  tags: readonly string[];
  to?: (tag: string) => string;
  onRemove?: (tag: string) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-3 p-0 text-sm" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag} className="inline-flex items-center">
          <Link
            to={to(tag)}
            className="tap text-ink-muted no-underline hover:text-accent hover:underline"
          >
            #{tag}
          </Link>
          {onRemove ? (
            <button
              type="button"
              className="tap text-ink-muted hover:text-danger"
              aria-label={`Remove tag ${tag}`}
              onClick={() => {
                onRemove(tag);
              }}
            >
              <CloseIcon />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The left-gutter marks. Each has an accessible name and is never the only cue. */
export function Marks({
  discovery,
  question,
}: {
  discovery: boolean;
  question: 'open' | 'solved' | null;
}) {
  return (
    // On a phone the marks sit in a row above the note, and take no room when there are none; from
    // 640px up they are a fixed gutter so every note's text lines up.
    <span className="flex shrink-0 flex-row items-center gap-1 empty:hidden phone:w-6 phone:flex-col phone:pt-1 phone:empty:flex">
      {discovery ? (
        <span role="img" aria-label="Discovery" className="text-discovery">
          <SparkIcon />
        </span>
      ) : null}
      {question === 'open' ? (
        <span
          role="img"
          aria-label="Open question"
          className="leading-none font-semibold text-question"
        >
          ?
        </span>
      ) : null}
      {question === 'solved' ? (
        <span role="img" aria-label="Solved question" className="text-ink-muted">
          <CheckIcon />
        </span>
      ) : null}
    </span>
  );
}
