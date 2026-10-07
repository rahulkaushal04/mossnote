import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FirstRun } from '../features/journals/FirstRun';
import { api, NetworkError } from '../lib/api';
import { listenForJournalSwitch } from '../lib/broadcast';
import {
  currentJournalId,
  markJournalChanged,
  setCurrentJournal,
  useJournalChanged,
} from '../lib/journal';
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
        Mossnote may not be running. Start it again (open the app, or run{' '}
        <code className="rounded-control bg-surface px-1.5 py-0.5">mossnote</code> in a terminal),
        then try again. Nothing you wrote is lost.
      </p>
      <div>
        <button type="button" className="btn tap" onClick={onRetry}>
          Retry
        </button>
      </div>
    </main>
  );
}

/** Shown over the app when another window switched journals, so this one never writes to the wrong one. */
function JournalChanged() {
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-raised p-3 text-ink shadow-float"
    >
      <span>You switched journals in another window. Reload to keep working here.</span>
      <button
        type="button"
        className="btn btn-primary tap"
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload
      </button>
    </div>
  );
}

/**
 * Renders the app once the server answers. While it cannot be reached the unreachable page is
 * shown and the server is retried every 5 seconds (paused while the tab is hidden, resumed on
 * focus), returning to the previous screen when it answers.
 */
export function ServerGate({ children }: { children: ReactNode }) {
  const changed = useJournalChanged();
  useEffect(
    () =>
      listenForJournalSwitch(() => {
        markJournalChanged();
      }),
    [],
  );
  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
    retry: false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => (query.state.status === 'error' ? RETRY_MS : false),
  });

  // This window keeps the journal it first saw. If the server later reports another one (a switch
  // made in a different window or browser), the window says so instead of following silently.
  const serverJournal = health.data?.journal ?? null;
  if (serverJournal !== null && currentJournalId() === null) setCurrentJournal(serverJournal);
  const shown = currentJournalId();
  useEffect(() => {
    if (serverJournal !== null && shown !== null && serverJournal !== shown) markJournalChanged();
  }, [serverJournal, shown]);

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
  // A brand new install has no journal yet: ask which template, then make it.
  if (health.data.journal === null) return <FirstRun />;
  return (
    <>
      {changed ? <JournalChanged /> : null}
      {children}
    </>
  );
}
