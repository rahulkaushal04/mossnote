import { formatCount } from '@shared/text';

/**
 * A badge states something real: a count or a status (unread, open). It takes no free-form
 * children on purpose, so it cannot turn into a decorative "New" pill (ADR 0009).
 */
export function Badge(props: { count: number } | { status: string }) {
  return (
    <span className="badge">{'count' in props ? formatCount(props.count) : props.status}</span>
  );
}
