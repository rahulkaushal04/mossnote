import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LIMITS } from '@shared/constants';
import type { CustomField, Person } from '@shared/types';
import { useNewNote } from '../../app/NewNote';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { EllipsisIcon } from '../../components/ui/icons';
import { FieldList, savableFields } from '../../components/ui/FieldList';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/Menu';
import { PageHeader } from '../../components/ui/PageHeader';
import { SavedIndicator } from '../../components/ui/SavedIndicator';
import { ListSkeleton, LoadError } from '../../components/ui/Skeleton';
import { TagEditor } from '../../components/ui/TagEditor';
import { ApiError } from '../../lib/api';
import { useAutosave } from '../../lib/useAutosave';
import { OnMaps } from '../maps/OnMaps';
import { NoteEntry } from '../notes/NoteEntry';
import { useDeletePerson, usePerson, usePersonNotes, useUpdatePerson } from './hooks';
import { ProgressPips } from './ProgressPips';
import { useTerms } from '../settings/useLayout';

const LABEL = 'text-sm font-semibold text-ink-2';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className={LABEL}>{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Name, edited inline: commits on Enter or when focus leaves. */
function NameField({ person }: { person: Person }) {
  const update = useUpdatePerson();
  const [name, setName] = useState(person.name);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Add a name.');
      setName(person.name);
      return;
    }
    setError(null);
    if (trimmed !== person.name) update.mutate({ id: person.id, patch: { name: trimmed } });
  };
  return (
    <div>
      <label>
        <span className="sr-only">Name</span>
        <input
          value={name}
          maxLength={LIMITS.personName}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="reading w-full border-0 border-b border-transparent bg-transparent text-2xl font-semibold hover:border-line focus:border-ink-muted"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "Track progress" asks for a maximum (1 to 99); that is the only configuration. */
function Progress({ person }: { person: Person }) {
  const update = useUpdatePerson();
  const [max, setMax] = useState('');
  const [asking, setAsking] = useState(false);
  const [clamp, setClamp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (person.progressMax === null) {
    return asking ? (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(max);
          if (!Number.isInteger(n) || n < 1 || n > LIMITS.progressMax) {
            setError('The maximum can be 1 to 99.');
            return;
          }
          update.mutate({ id: person.id, patch: { progressMax: n, progress: 0 } });
          setAsking(false);
        }}
      >
        <label className="flex items-center gap-2">
          <span className="sr-only">Maximum</span>
          <input
            type="number"
            min={1}
            max={LIMITS.progressMax}
            placeholder="max"
            value={max}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setMax(e.target.value);
              setError(null);
            }}
            className="field-input w-24"
          />
        </label>
        <button type="submit" className="btn tap">
          Set
        </button>
        {error ? (
          <span role="alert" className="text-sm text-danger">
            {error}
          </span>
        ) : null}
      </form>
    ) : (
      <button
        type="button"
        className="tap underline"
        onClick={() => {
          setAsking(true);
        }}
      >
        Track progress
      </button>
    );
  }

  const value = person.progress ?? 0;
  const newMax = person.progressMax;
  return (
    <div className="flex flex-col gap-2">
      <ProgressPips
        value={value}
        max={newMax}
        onChange={(n) => {
          update.mutate({ id: person.id, patch: { progress: n } });
        }}
      />
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <span>Maximum</span>
          <input
            type="number"
            min={1}
            max={LIMITS.progressMax}
            defaultValue={newMax}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (!Number.isInteger(n) || n < 1 || n > LIMITS.progressMax) {
                e.target.value = String(newMax);
                return;
              }
              if (n === newMax) return;
              if (n < value) setClamp(n);
              else update.mutate({ id: person.id, patch: { progressMax: n } });
            }}
            className="field-input w-20"
          />
        </label>
        <button
          type="button"
          className="tap underline"
          onClick={() => {
            update.mutate({ id: person.id, patch: { progress: null, progressMax: null } });
          }}
        >
          Stop tracking
        </button>
      </div>
      <ConfirmDialog
        open={clamp !== null}
        onOpenChange={(open) => {
          if (!open) setClamp(null);
        }}
        title="Lower the maximum?"
        message={`Progress is ${value}, which is higher than ${clamp ?? 0}. It will be set to ${clamp ?? 0}.`}
        confirmLabel="Lower it"
        onConfirm={() => {
          if (clamp !== null)
            update.mutate({ id: person.id, patch: { progressMax: clamp, progress: clamp } });
        }}
      />
    </div>
  );
}

/** The running description. Autosaves, with a quiet "Saved". */
function NotesField({ person }: { person: Person }) {
  const update = useUpdatePerson();
  const [text, setText] = useState(person.notes);
  const latest = useRef(text);
  const autosave = useAutosave(async () => {
    if (latest.current !== person.notes) {
      await update.mutateAsync({ id: person.id, patch: { notes: latest.current } });
    }
  });
  return (
    <div>
      <label className="flex flex-col gap-1">
        <span className="sr-only">Notes about this person</span>
        <textarea
          rows={5}
          value={text}
          maxLength={LIMITS.personNotes}
          placeholder="Anything you want to remember."
          onChange={(e) => {
            latest.current = e.target.value;
            setText(e.target.value);
            autosave.schedule();
          }}
          onBlur={autosave.flush}
          className="reading w-full rounded-md border border-line bg-paper p-2"
        />
      </label>
      <SavedIndicator show={autosave.saved} />
      {autosave.error ? (
        <p role="alert" className="text-sm text-danger">
          {autosave.error}
        </p>
      ) : null}
    </div>
  );
}

function Fields({ person }: { person: Person }) {
  const update = useUpdatePerson();
  const [fields, setFields] = useState<CustomField[]>(person.customFields);
  const latest = useRef(fields);
  const autosave = useAutosave(async () => {
    const clean = savableFields(latest.current);
    if (clean) await update.mutateAsync({ id: person.id, patch: { customFields: clean } });
  });
  return (
    <div>
      <FieldList
        fields={fields}
        kind="person"
        onChange={(next) => {
          latest.current = next;
          setFields(next);
          autosave.schedule();
        }}
      />
      <SavedIndicator show={autosave.saved} />
    </div>
  );
}

function Backlinks({ person }: { person: Person }) {
  const notes = usePersonNotes(person.id);
  const newNote = useNewNote();
  const list = notes.data?.pages.flatMap((p) => p.items) ?? [];
  const write = () => {
    newNote.requestNewNote({ links: [{ type: 'person', id: person.id, label: person.name }] });
  };
  return (
    <Section title={`Notes about ${person.name}`}>
      <button type="button" className="btn tap" onClick={write}>
        Write about {person.name}
      </button>
      {notes.isError ? <LoadError onRetry={() => void notes.refetch()} /> : null}
      {list.length === 0 && !notes.isPending && !notes.isError ? (
        <EmptyState>No notes mention {person.name} yet.</EmptyState>
      ) : null}
      {list.length > 0 ? (
        <ul aria-label={`Notes about ${person.name}`} className="m-0 mt-2 list-none p-0">
          {list.map((note) => (
            <NoteEntry key={note.id} note={note} />
          ))}
        </ul>
      ) : null}
      {notes.hasNextPage ? (
        <button type="button" className="btn tap mt-3" onClick={() => void notes.fetchNextPage()}>
          Load more
        </button>
      ) : null}
    </Section>
  );
}

/** `/people/:id`: everything the user has recorded about one person, in their own words. */
export function PersonPage() {
  const terms = useTerms();
  const { id = '' } = useParams();
  const query = usePerson(id);
  const navigate = useNavigate();
  const remove = useDeletePerson();
  const person = query.data;
  const gone =
    query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);

  const update = useUpdatePerson();

  return (
    <>
      <PageHeader title={person?.name ?? 'Person'} documentTitle={person?.name ?? 'Person'} />
      <p className="py-2">
        <Link to="/people">← {terms.people.label}</Link>
      </p>
      <ListSkeleton pending={query.isPending} />
      {gone ? (
        <EmptyState>
          This person isn&apos;t here. <Link to="/settings#trash">Recently deleted</Link>
        </EmptyState>
      ) : query.isError ? (
        <LoadError onRetry={() => void query.refetch()} />
      ) : null}
      {person ? (
        <div key={person.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <NameField key={`name-${person.name}`} person={person} />
            </div>
            <Menu>
              <MenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More actions"
                  className="tap rounded-md px-1 hover:bg-surface"
                >
                  <EllipsisIcon />
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem
                  danger
                  onSelect={() => {
                    remove.mutate(person, {
                      onSuccess: () => {
                        void navigate('/people');
                      },
                    });
                  }}
                >
                  Delete
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
          <Section title="Progress">
            <Progress person={person} />
          </Section>
          <Section title="Tags">
            <TagEditor
              tags={person.tags}
              linkBase="/people"
              onChange={(tags) => {
                update.mutate({ id: person.id, patch: { tags } });
              }}
            />
          </Section>
          <Section title="Notes">
            <NotesField person={person} />
          </Section>
          <Section title="Fields">
            <Fields person={person} />
          </Section>
          <Backlinks person={person} />
          <OnMaps type="person" id={person.id} />
        </div>
      ) : null}
    </>
  );
}
