import type { Calendar } from '@shared/constants';
import { dayNumber, decode, isCounter, isValid } from '@shared/gameDate';

/** `Spring 3, Year 1` (or `Day 12` for a day counter), for screen readers. */
export function spokenDate(key: number, calendar: Calendar): string | undefined {
  if (!isValid(key, calendar)) return undefined;
  if (isCounter(calendar)) return `${calendar.seasons[0]?.name ?? 'Day'} ${dayNumber(key)}`;
  const { year, season, day } = decode(key);
  return `${calendar.seasons[season]?.name ?? ''} ${day}, Year ${year}`;
}
