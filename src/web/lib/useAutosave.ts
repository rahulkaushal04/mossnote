import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Autosave for a field: `schedule` after each change saves 800 ms later (or at once with `flush`,
 * for blur), and `saved` turns on briefly after a successful save for the "Saved" indicator.
 */
export function useAutosave(save: () => Promise<unknown>, delay = 800) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(save);
  useEffect(() => {
    latest.current = save;
  });

  const run = useCallback(async () => {
    timer.current = undefined;
    try {
      await latest.current();
      setError(null);
      setSaved(true);
      clearTimeout(shown.current);
      shown.current = setTimeout(() => {
        setSaved(false);
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that change.");
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delay);
  }, [run, delay]);

  const flush = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      void run();
    }
  }, [run]);

  useEffect(
    () => () => {
      clearTimeout(shown.current);
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        void latest.current().catch(() => undefined);
      }
    },
    [],
  );

  return { schedule, flush, saved, error };
}
