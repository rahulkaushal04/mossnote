import type { ReactNode } from 'react';

/**
 * What an empty list is for, and what to do next. The sentence is the message; an icon and one
 * action (a button that starts the first item) are optional. Without them it is a single quiet line.
 * `art` is a small line drawing from `./art`, for the screens that are empty on first use.
 */
export function EmptyState({
  children,
  icon,
  art,
  action,
}: {
  children: ReactNode;
  icon?: ReactNode;
  art?: ReactNode;
  action?: ReactNode;
}) {
  if (!icon && !art && !action) return <p className="py-8 text-base text-ink-muted">{children}</p>;
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      {/* The line art wears the journal's tint, quietly: it is the one place colour is decoration. */}
      {art ? <span className="text-accent opacity-70">{art}</span> : null}
      {icon && !art ? (
        <span
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-full bg-surface text-2xl text-ink-muted"
        >
          {icon}
        </span>
      ) : null}
      <p
        className={
          art || icon
            ? 'm-0 max-w-sm font-serif text-lg leading-snug text-ink-2'
            : 'm-0 max-w-sm text-base text-ink-muted'
        }
      >
        {children}
      </p>
      {action}
    </div>
  );
}
