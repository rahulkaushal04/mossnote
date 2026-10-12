import { useEffect } from 'react';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { Page } from '@shared/types';

/**
 * The lists that filter, group and check for duplicates in the page need every item, so this keeps
 * fetching pages until the last one. `items` fills as pages arrive; `loadingMore` is true while
 * pages remain. A failed page stops the fetching and shows as `isError`; `refetch` tries again.
 */
export function useAllPages<T>(query: UseInfiniteQueryResult<InfiniteData<Page<T>>>) {
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    loaded: query.data !== undefined,
    loadingMore: hasNextPage && !isFetchNextPageError,
    isPending: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  };
}
