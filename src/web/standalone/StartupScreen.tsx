import { useEffect } from 'react';
import type { StartupProblem } from '@shared/standaloneProtocol';

interface StartupScreenProps {
  problem: StartupProblem;
  message: string;
}

const TITLES: Record<StartupProblem, string> = {
  unsupported: "This browser can't keep your journal.",
  storage_busy: 'Mossnote is open in another tab.',
  failed: "Mossnote couldn't open your journal.",
};

/** Full-page explanation when the standalone web app cannot start, with the one thing to try. */
export function StartupScreen({ problem, message }: StartupScreenProps) {
  const title = TITLES[problem];
  useEffect(() => {
    document.title = `${title} · Mossnote`;
  }, [title]);

  return (
    <main className="mx-auto flex min-h-screen max-w-176 flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {problem === 'unsupported' ? (
        <>
          <p>
            Mossnote keeps your journal inside the browser, and this browser doesn&apos;t allow
            that.
            {message ? ` ${message}` : ''}
          </p>
          <p>
            Try an up-to-date Safari, Chrome, Edge or Firefox, in a normal window instead of a
            private one. Or run Mossnote on your computer, where it keeps your journals in a folder.
          </p>
        </>
      ) : null}
      {problem === 'storage_busy' ? (
        <p>
          Your journal can only be open in one tab at a time, so it can&apos;t be changed in two
          places at once. Close the other Mossnote tab or window, then open this one again. Nothing
          you wrote is lost.
        </p>
      ) : null}
      {problem === 'failed' ? (
        <p>
          Something went wrong while starting up. Nothing you wrote was changed.
          {message ? ` The browser said: ${message}` : ''}
        </p>
      ) : null}
      {problem === 'unsupported' ? null : (
        <div>
          <button
            type="button"
            className="btn btn-primary tap"
            onClick={() => {
              window.location.reload();
            }}
          >
            Try again
          </button>
        </div>
      )}
    </main>
  );
}
