import { useEffect, useState, type ReactNode } from 'react';
import { Logo } from '../../components/ui/Logo';
import { JournalIcon, LockIcon } from '../../components/ui/icons';
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
    <main className="mx-auto grid min-h-screen max-w-[64rem] content-center gap-x-16 gap-y-8 px-5 py-12 wide:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] wide:gap-y-0">
      <div className="wide:self-end">
        <Logo className="mb-6 size-14" />
        <h1 className="page-title text-[2.5rem] leading-[1.05] phone:text-[3.25rem]">
          Welcome to <em>Mossnote</em>
        </h1>
        <p className="page-intro">
          A private journal for the games you play. Pick a starting point; you can add more journals
          later, one for each game.
        </p>
      </div>
      <div className="wide:row-span-2">
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
      </div>
      {/* The promises, as facts and not as a policy: each is true of the app as built. */}
      <ul className="m-0 flex list-none flex-col gap-4 p-0 wide:mt-10 wide:self-start">
        <Fact icon={<JournalIcon />} title="No spoilers">
          Mossnote knows nothing about any game, so it can never spoil one.
        </Fact>
        <Fact icon={<LockIcon />} title="Yours alone">
          Your journal lives {WHERE_IT_LIVES.place}; nothing is sent over the internet. No account,
          no analytics, no update checks.
        </Fact>
      </ul>
    </main>
  );
}

function Fact({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-lg text-accent"
      >
        {icon}
      </span>
      <span className="text-sm text-ink-2">
        <strong className="block text-base font-semibold text-ink">{title}</strong>
        {children}
      </span>
    </li>
  );
}
