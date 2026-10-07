import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, NetworkError } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

const RETRY_MS = 5000;

/** Full-page message when the API cannot be reached. */
export function Unreachable({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    document.title = "Can't reach your journal · Mossnote";
  }, []);
  return (
    <main className="mx-auto flex min-h-screen max-w-[44rem] flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">Can&apos;t reach your journal.</h1>
      <p>
        Mossnote may not be running. Start it from its folder with{' '}
        <code className="rounded-control bg-surface px-1.5 py-0.5">npm start</code>, then try again.
      </p>
      <div>
        <button type="button" className="btn tap" onClick={onRetry}>
          Retry
        </button>
      </div>
    </main>
  );
}

/**
 * Renders the app once the server answers. While it cannot be reached the unreachable page is
 * shown and the server is retried every 5 seconds (paused while the tab is hidden, resumed on
 * focus), returning to the previous screen when it answers.
 */
export function ServerGate({ children }: { children: ReactNode }) {
  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
    retry: false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => (query.state.status === 'error' ? RETRY_MS : false),
  });

  if (health.error instanceof NetworkError) {
    return (
      <Unreachable
        onRetry={() => {
          void health.refetch();
        }}
      />
    );
  }
  if (health.error) throw health.error;
  if (health.isPending) return null;
  return <>{children}</>;
}
