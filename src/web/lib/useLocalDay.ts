import { useEffect, useState } from 'react';
import { localDayKey } from './format';

/**
 * The user's local calendar day, refreshed when the tab regains focus, so a tab left open past
 * midnight shows the new day.
 */
export function useLocalDay(): { key: string; start: number; end: number } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => {
      setNow(Date.now());
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return { key: localDayKey(now), start, end: start + 24 * 3_600_000 - 1 };
}
