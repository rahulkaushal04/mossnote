import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { broadcastJournalSwitched } from '../../lib/broadcast';
import { showJournal } from '../../lib/journal';
import { WHERE_IT_LIVES } from '../../lib/mode';
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
    <main className="mx-auto flex min-h-screen max-w-[40rem] flex-col justify-center gap-8 px-5 py-12">
      <div>
        <h1 className="page-title">
          Welcome to <em>Mossnote</em>
        </h1>
        <p className="page-intro">
          A private journal for the games you play. It lives {WHERE_IT_LIVES.place}, never sends
          anything over the internet, and starts out empty. Pick a starting point. You can add more
          journals later, one for each game.
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
              setError(journalProblem(e, "Couldn't create the journal. Nothing was changed."));
            });
        }}
      />
    </main>
  );
}
