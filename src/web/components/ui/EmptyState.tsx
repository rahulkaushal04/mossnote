import type { ReactNode } from 'react';

/**
 * What an empty list is for, and what to do next. The sentence is the message; an icon and one
 * action (a button that starts the first item) are optional. Without them it is a single quiet line.
 */
export function EmptyState({
  children,
  icon,
  action,
}: {
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  if (!icon && !action) return <p className="py-8 text-base text-ink-muted">{children}</p>;
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      {icon ? (
        <span
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-full bg-surface text-2xl text-ink-muted"
        >
          {icon}
        </span>
      ) : null}
      <p className="m-0 max-w-sm text-base text-ink-muted">{children}</p>
      {action}
    </div>
  );
}
