import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LIMITS } from '@shared/constants';
import type { CustomField, Planting } from '@shared/types';
import { useNewNote } from '../../app/NewNote';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { FieldList, savableFields } from '../../components/ui/FieldList';
import { EllipsisIcon } from '../../components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/Menu';
import { SavedIndicator } from '../../components/ui/SavedIndicator';
import { ListSkeleton, LoadError } from '../../components/ui/Skeleton';
import { TagEditor } from '../../components/ui/TagEditor';
import { ApiError } from '../../lib/api';
import { useAutosave } from '../../lib/useAutosave';
import { GameDateChip } from '../calendar/GameDateChip';
import { OnMaps } from '../maps/OnMaps';
import { NoteEntry } from '../notes/NoteEntry';
import { useDeletePlanting, usePlanting, usePlantingNotes, useUpdatePlanting } from './hooks';
import { useTerms } from '../settings/useLayout';
import { sentence } from '@shared/text';

const LABEL = 'text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className={LABEL}>{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A count field: whole number from 0 to 999,999, or blank. Errors appear beside the field. */
function CountField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number | null;
  onSave: (n: number | null) => Promise<unknown>;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const trimmed = text.trim();
    const n = trimmed === '' ? null : Number(trimmed);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > LIMITS.count)) {
      setError('Use a whole number from 0 to 999,999.');
      return;
    }
    setError(null);
    if (n !== value)
      void onSave(n).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Couldn't save that change.");
      });
  };
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      <input
        inputMode="numeric"
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="tap w-32 rounded-control border border-ink-muted bg-paper px-2"
      />
      {error ? (
        <span role="alert" className="text-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function Details({ entry }: { entry: Planting }) {
  const update = useUpdatePlanting();
  const newNote = useNewNote();
  const notes = usePlantingNotes(entry.id);
  const [name, setName] = useState(entry.label);
  const [fields, setFields] = useState<CustomField[]>(entry.customFields);
  const [text, setText] = useState(entry.notes);
  const [dateError, setDateError] = useState<string | null>(null);
  const latestText = useRef(text);
  const latestFields = useRef(fields);

  const save = (patch: Parameters<typeof update.mutateAsync>[0]['patch']) =>
    update.mutateAsync({ id: entry.id, patch });
  const saveDate = (field: 'plantedOn' | 'harvestedOn', key: number | null) => {
    setDateError(null);
    save({ [field]: key }).catch((e: unknown) => {
      setDateError(e instanceof ApiError ? e.message : "Couldn't save that change.");
    });
  };

  const notesSave = useAutosave(async () => {
    if (latestText.current !== entry.notes) await save({ notes: latestText.current });
  });
  const fieldsSave = useAutosave(async () => {
    const clean = savableFields(latestFields.current);
    if (clean) await save({ customFields: clean });
  });
  const list = notes.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <label>
        <span className="sr-only">Name</span>
        <input
          value={name}
          maxLength={LIMITS.plantingLabel}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed === '') setName(entry.label);
            else if (trimmed !== entry.label) void save({ label: trimmed });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="reading w-full border-0 border-b border-transparent bg-transparent text-xl font-semibold hover:border-rule focus:border-ink-muted"
        />
      </label>

      <Section title="Dates">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Planted</span>
          <GameDateChip
            value={entry.plantedOn}
            onChange={(k) => {
              saveDate('plantedOn', k);
            }}
            emptyLabel="Add date"
            clearLabel="Clear date"
            title="Planted on"
          />
          <span>Harvested</span>
          <GameDateChip
            value={entry.harvestedOn}
            onChange={(k) => {
              saveDate('harvestedOn', k);
            }}
            emptyLabel="Add date"
            clearLabel="Clear date"
            title="Harvested on"
          />
        </div>
        {dateError ? (
          <p role="alert" className="mt-1 text-sm text-danger">
            {dateError}
          </p>
        ) : null}
      </Section>

      <Section title="Counts">
        <div className="flex flex-wrap gap-4">
          <CountField
            label="Planted count"
            value={entry.plantedCount}
            onSave={(n) => save({ plantedCount: n })}
          />
          <CountField
            label="Harvested count"
            value={entry.harvestedCount}
            onSave={(n) => save({ harvestedCount: n })}
          />
        </div>
      </Section>

      <Section title="Notes">
        <label className="flex flex-col gap-1">
          <span className="sr-only">Notes about this entry</span>
          <textarea
            rows={4}
            value={text}
            maxLength={LIMITS.plantingNotes}
            placeholder="Anything you want to remember."
            onChange={(e) => {
              latestText.current = e.target.value;
              setText(e.target.value);
              notesSave.schedule();
            }}
            onBlur={notesSave.flush}
            className="reading w-full rounded-control border border-rule bg-paper p-2"
          />
        </label>
        <SavedIndicator show={notesSave.saved} />
      </Section>

      <Section title="Tags">
        <TagEditor tags={entry.tags} linkBase="/farm" onChange={(tags) => void save({ tags })} />
      </Section>

      <Section title="Fields">
        <FieldList
          fields={fields}
          kind="planting"
          onChange={(next) => {
            latestFields.current = next;
            setFields(next);
            fieldsSave.schedule();
          }}
        />
        <SavedIndicator show={fieldsSave.saved} />
      </Section>

      <Section title="Notes about this">
        <button
          type="button"
          className="btn tap"
          onClick={() => {
            newNote.requestNewNote({
              links: [{ type: 'planting', id: entry.id, label: entry.label }],
            });
          }}
        >
          Write about this
        </button>
        {list.length === 0 && !notes.isPending ? (
          <EmptyState>No notes mention this yet.</EmptyState>
        ) : null}
        {list.length > 0 ? (
          <ul aria-label="Notes about this entry" className="m-0 mt-2 list-none p-0">
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
      <OnMaps type="planting" id={entry.id} />
    </div>
  );
}

/**
 * `/farm/:id`: a 420px sheet over the list on wide screens, a full page on narrow ones. It is a
 * route, so it can be bookmarked and closed with Back or Esc (spec section 7).
 */
export function PlantingSheet() {
  const terms = useTerms();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = usePlanting(id);
  const remove = useDeletePlanting();
  const entry = query.data;
  const gone =
    query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
  const close = () => {
    void navigate('/farm');
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={entry?.label ?? sentence(terms.farm.one)}
      placement="right"
    >
      <div className="flex items-center justify-between">
        <Link to="/farm">← {terms.farm.label}</Link>
        {entry ? (
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className="tap rounded-control px-1 hover:bg-surface"
              >
                <EllipsisIcon />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem
                danger
                onSelect={() => {
                  remove.mutate(entry, { onSuccess: close });
                }}
              >
                Delete
              </MenuItem>
            </MenuContent>
          </Menu>
        ) : null}
      </div>
      <ListSkeleton pending={query.isPending} />
      {gone ? (
        <EmptyState>
          This entry isn&apos;t here. <Link to="/settings#trash">Recently deleted</Link>
        </EmptyState>
      ) : query.isError ? (
        <LoadError onRetry={() => void query.refetch()} />
      ) : null}
      {entry ? <Details key={entry.id} entry={entry} /> : null}
    </Dialog>
  );
}
