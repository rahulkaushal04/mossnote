import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { CheckIcon } from './icons';

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
      className={cx('chip chip-toggle', selected && 'chip-selected', className)}
    >
      {body}
    </button>
  );
}
