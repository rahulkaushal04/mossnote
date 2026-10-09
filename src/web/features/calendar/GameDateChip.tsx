import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { useCalendar } from './CalendarProvider';
import { spokenDate } from './dateLabels';
import { GameDatePicker } from './GameDatePicker';

type ChipButtonProps = ComponentPropsWithoutRef<'button'> & {
  label: string;
  spoken?: string | undefined;
};

/** The chip itself: quiet muted text with a hairline, not a filled pill. */
export const ChipButton = forwardRef<HTMLButtonElement, ChipButtonProps>(function ChipButton(
  { label, spoken, className = '', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={spoken ? `${spoken}. Change date` : label}
      className={`tap tnum shrink-0 rounded-md border border-line px-2 py-0.5 text-sm whitespace-nowrap text-ink hover:bg-surface ${className}`}
      {...props}
    >
      {label}
    </button>
  );
});

export interface GameDateChipProps {
  value: number | null;
  onChange: (key: number | null) => void;
  /** Text when there is no date, for example "Set date" or "Add date". */
  emptyLabel: string;
  clearLabel?: string | undefined;
  title: string;
  /** Show the year even when it matches the current year. */
  withYear?: boolean;
  className?: string;
  /** Control the picker from outside (the `/date` command). */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}

/** A game date as a button that opens the date picker. */
export function GameDateChip({
  value,
  onChange,
  emptyLabel,
  clearLabel,
  title,
  withYear = true,
  className,
  open,
  onOpenChange,
}: GameDateChipProps) {
  const calendar = useCalendar();
  const label = value === null ? emptyLabel : (calendar.format(value, { withYear }) ?? emptyLabel);
  return (
    <GameDatePicker
      value={value}
      onChange={onChange}
      clearLabel={clearLabel}
      title={title}
      open={open}
      onOpenChange={onOpenChange}
    >
      <ChipButton
        label={label}
        spoken={value === null ? undefined : spokenDate(value, calendar.calendar)}
        {...(className ? { className } : {})}
      />
    </GameDatePicker>
  );
}
