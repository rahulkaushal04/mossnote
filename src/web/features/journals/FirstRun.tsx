import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { broadcastJournalSwitched } from '../../lib/broadcast';
import { showJournal } from '../../lib/journal';
import { journalProblem } from './hooks';
import { NewJournalForm } from './NewJournalForm';

/**
 * The screen a brand new install shows instead of an empty journal: one question, "Which
 * template?", with Default already chosen. Nothing is written until the button is pressed.
 */
export function FirstRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Welcome · Mossnote';
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-[44rem] flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Welcome to Mossnote</h1>
        <p className="mt-2 text-ink-muted">
          A private journal for the games you play. It lives on this computer, never connects to the
          internet, and starts empty. Choose how it should be set up. You can make more journals
          later, one for each game.
        </p>
      </div>
      <NewJournalForm
        idPrefix="first-run"
        submitLabel="Start my journal"
        busy={busy}
        error={error}
        onSubmit={(input) => {
          setBusy(true);
          setError(null);
          api
            .createJournal(input)
            .then((made) => {
              broadcastJournalSwitched(made.id);
              showJournal();
            })
            .catch((e: unknown) => {
              setBusy(false);
              setError(journalProblem(e, "Couldn't make the journal. Nothing was changed."));
            });
        }}
      />
    </main>
  );
}
