import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { Tip } from './Tooltip';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** The accessible name, and the tooltip text on pointer devices. */
  label: string;
  icon: ReactNode;
  /** Shortcut hint shown in the tooltip; pass the same keys as `aria-keyshortcuts`. */
  keys?: string;
  /** For toggles, such as a map tool. */
  pressed?: boolean;
  variant?: 'ghost' | 'secondary' | 'primary';
}

/** A square button with only an icon. It always has a name, and a tooltip for pointer users. */
export function IconButton({
  label,
  icon,
  keys,
  pressed,
  variant = 'ghost',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <Tip label={label} keys={keys}>
      <button
        {...rest}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        className={cx(
          'btn btn-icon',
          variant === 'ghost' && 'btn-ghost',
          variant === 'primary' && 'btn-primary',
          className,
        )}
      >
        {icon}
      </button>
    </Tip>
  );
}
