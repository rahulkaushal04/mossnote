import { decode } from '@shared/gameDate';
import { useToast } from '../../components/ui/Toast';
import { useCalendar } from './CalendarProvider';
import { useSetCurrentDate } from './useCurrentDate';

/**
 * Move the current game date by one day and offer Undo for 6 seconds (spec section 5.3).
 * Returns null helpers' availability so buttons and shortcuts can disable themselves.
 */
export function useAdvanceDay() {
  const calendar = useCalendar();
  const toast = useToast();
  const setDate = useSetCurrentDate();
  const current = calendar.currentGameDate;

  const move = (days: number) => {
    if (current === null) return;
    const target = calendar.advance(current, days);
    if (target === null) return;
    setDate.mutate(target);
    const yearChanged = decode(target).year !== decode(current).year;
    toast.show({
      message: `Now ${calendar.format(target, { withYear: yearChanged }) ?? ''}`,
      actionLabel: 'Undo',
      duration: 6000,
      onAction: () => {
        setDate.mutate(current);
      },
    });
  };

  return {
    hasDate: current !== null,
    canGoPrevious: current !== null && calendar.advance(current, -1) !== null,
    canGoNext: current !== null && calendar.advance(current, 1) !== null,
    next: () => {
      move(1);
    },
    previous: () => {
      move(-1);
    },
  };
}
