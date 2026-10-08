import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: '',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** One primary per view; everything else is secondary or ghost. */
  variant?: ButtonVariant;
  /** Work in progress: the button cannot be pressed again and shows a spinner for its icon. */
  busy?: boolean;
  icon?: ReactNode;
}

/** The app's button. The label is a verb; the look comes from the `btn` classes in index.css. */
export function Button({
  variant = 'secondary',
  busy = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={Boolean(disabled) || busy}
      aria-busy={busy || undefined}
      className={cx('btn', VARIANT_CLASS[variant], className)}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
