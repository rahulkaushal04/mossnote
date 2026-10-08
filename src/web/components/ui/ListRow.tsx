import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Avatar } from './Avatar';

/**
 * One hairline row: an optional monogram, a serif title and muted tabular meta at the right.
 * A link when it has a destination, so the whole row is the target. Rows are not cards.
 */
export function ListRow({
  to,
  title,
  meta,
  leading,
}: {
  to?: string;
  title: ReactNode;
  meta?: ReactNode;
  /** A name to draw a monogram for. */
  leading?: string;
}) {
  const body = (
    <>
      {leading ? <Avatar name={leading} /> : null}
      <span className="list-row-title min-w-0 truncate">{title}</span>
      {meta ? <span className="list-row-meta">{meta}</span> : null}
    </>
  );
  return to ? (
    <Link to={to} className="list-row">
      {body}
    </Link>
  ) : (
    <div className="list-row">{body}</div>
  );
}
