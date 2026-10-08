import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { CheckIcon, CloseIcon } from './icons';

/**
 * A small pill. With `onToggle` it is a filter toggle (a button with `aria-pressed`), and a
 * selected one also shows a check so it does not rely on colour alone. Without it, it is text.
 */
export function Chip({
  selected = false,
  onToggle,
  className,
  children,
}: {
  selected?: boolean;
  onToggle?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const body = (
    <>
      {selected ? <CheckIcon className="size-3.5" /> : null}
      {children}
    </>
  );
  if (!onToggle) return <span className={cx('chip', className)}>{body}</span>;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cx('pill', className)}
    >
      {body}
    </button>
  );
}

/** An active filter shown as a pill that removes itself when pressed. */
export function RemovableChip({
  label,
  removeLabel,
  onRemove,
  className,
}: {
  label: string;
  /** What the button does, for screen readers: "Remove tag filter crops". */
  removeLabel: string;
  onRemove: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed="true"
      aria-label={removeLabel}
      onClick={onRemove}
      className={cx('pill shrink-0', className)}
    >
      {label}
      <CloseIcon className="size-3.5" />
    </button>
  );
}
