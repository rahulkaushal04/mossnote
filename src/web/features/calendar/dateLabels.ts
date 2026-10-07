import type { Calendar } from '@shared/constants';
import { decode, isValid } from '@shared/gameDate';

/** `Spring 3, Year 1`, for screen readers. */
export function spokenDate(key: number, calendar: Calendar): string | undefined {
  if (!isValid(key, calendar)) return undefined;
  const { year, season, day } = decode(key);
  return `${calendar.seasons[season]?.name ?? ''} ${day}, Year ${year}`;
}
