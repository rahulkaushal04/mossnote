import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { NetworkError } from './api';
import { queryKeys } from './queryKeys';

/** Defaults from spec section 12. GETs retry once, mutations never retry automatically. */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Any request that cannot reach the server re-checks health, which shows the
        // "Can't reach your journal" page and starts the reconnect poll. The health query
        // itself is excluded, otherwise its failure would invalidate it again in a loop.
        if (query.queryKey[0] === queryKeys.health[0]) return;
        if (error instanceof NetworkError)
          void client.invalidateQueries({ queryKey: queryKeys.health });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (error instanceof NetworkError)
          void client.invalidateQueries({ queryKey: queryKeys.health });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => !(error instanceof NetworkError) && failureCount < 1,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
