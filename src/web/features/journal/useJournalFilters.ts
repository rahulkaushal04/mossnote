import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { NoteFilters } from '../../lib/api';

export type FlagFilter = 'all' | 'discovery' | 'question';
export type QuestionState = 'open' | 'solved' | 'all';

export interface JournalFilters {
  flag: FlagFilter;
  state: QuestionState;
  tags: string[];
  undated: boolean;
  order: 'asc' | 'desc';
}

/**
 * Filters and sort order live in the URL, for example
 * `/journal?flag=question&state=open&tag=idea&order=asc`, so a reload or a
 * bookmark reproduces the same view. Changes use `replace`, so Back leaves the page.
 */
export function useJournalFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<JournalFilters>(() => {
    const flag = params.get('flag');
    const state = params.get('state');
    return {
      flag: flag === 'discovery' || flag === 'question' ? flag : 'all',
      state: state === 'open' || state === 'solved' ? state : 'all',
      tags: params.getAll('tag').filter((t) => t.trim() !== ''),
      undated: params.get('undated') === '1',
      order: params.get('order') === 'asc' ? 'asc' : 'desc',
    };
  }, [params]);

  const update = useCallback(
    (next: Partial<JournalFilters>) => {
      const merged = { ...filters, ...next };
      const out = new URLSearchParams();
      if (merged.flag !== 'all') out.set('flag', merged.flag);
      if (merged.flag === 'question' && merged.state !== 'all') out.set('state', merged.state);
      for (const tag of merged.tags) out.append('tag', tag);
      if (merged.undated) out.set('undated', '1');
      if (merged.order === 'asc') out.set('order', 'asc');
      setParams(out, { replace: true });
    },
    [filters, setParams],
  );

  const clear = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);

  /** The API filters for these URL filters. */
  const query = useMemo<NoteFilters>(() => {
    const q: NoteFilters = { order: filters.order, limit: 50 };
    if (filters.flag !== 'all') q.flag = filters.flag;
    if (filters.flag === 'question' && filters.state !== 'all') q.state = filters.state;
    if (filters.tags.length > 0) q.tag = filters.tags;
    if (filters.undated) q.undated = true;
    return q;
  }, [filters]);

  const active = filters.flag !== 'all' || filters.tags.length > 0 || filters.undated;
  return { filters, query, update, clear, active };
}
