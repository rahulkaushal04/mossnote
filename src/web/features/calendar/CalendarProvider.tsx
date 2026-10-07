import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Calendar } from '@shared/constants';
import * as gameDate from '@shared/gameDate';
import { NetworkError } from '../../lib/api';
import { useSettings } from '../settings/useSettings';

export interface CalendarApi {
  calendar: Calendar;
  /** The game date the user says it is now, or null. */
  currentGameDate: number | null;
  format(key: number, options?: { withYear?: boolean }): string | null;
  parse(text: string): gameDate.GameDateQuery | null;
  advance(key: number, days: number): number | null;
  isValid(key: unknown): key is number;
}

const CalendarContext = createContext<CalendarApi | null>(null);

export function useCalendar(): CalendarApi {
  const value = useContext(CalendarContext);
  if (!value) throw new Error('useCalendar must be used inside <CalendarProvider>.');
  return value;
}

/** Exposes memoised date helpers bound to the user's calendar (spec section 12). */
export function CalendarProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error } = useSettings();

  const api = useMemo<CalendarApi | null>(() => {
    if (!data) return null;
    const { calendar, currentGameDate } = data;
    return {
      calendar,
      currentGameDate,
      format: (key, options) => gameDate.format(key, calendar, options),
      parse: (text) => gameDate.parse(text, calendar),
      advance: (key, days) => gameDate.advance(key, calendar, days),
      isValid: (key): key is number => gameDate.isValid(key, calendar),
    };
  }, [data]);

  // A failed request that cannot reach the server is the gate's job (it shows the unreachable
  // page); anything else is a real error for the route boundary.
  if (error && !data && !(error instanceof NetworkError)) throw error;
  if (isPending || !api) return null;
  return <CalendarContext.Provider value={api}>{children}</CalendarContext.Provider>;
}
