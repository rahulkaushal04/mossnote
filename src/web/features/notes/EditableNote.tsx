import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CaptureEditor } from '../capture/CaptureEditor';
import type { NoteDraft } from '../capture/draft';
import type { Note } from '@shared/types';
import { useDeleteNote, useUpdateNote } from './hooks';
import { diffDraft, hasContent, noteToDraft } from './noteDraft';

const AUTOSAVE_MS = 800;

/**
 * A note edited where it is shown. Autosaves 800 ms after the last change and
 * when focus leaves; there is no Save button. Esc, `mod+Enter`, Done, or clicking outside ends it.
 * A stale save (409) shows a banner and never overwrites the newer version silently.
 */
export function EditableNote({
  note,
  onDone,
  initialAction,
  defaultGameDate,
}: {
  note: Note;
  onDone: () => void;
  initialAction?: 'title' | 'link' | undefined;
  defaultGameDate: number | null;
}) {
  const update = useUpdateNote();
  const remove = useDeleteNote();
  const [draft, setDraft] = useState<NoteDraft>(() => noteToDraft(note));
  const [saved, setSaved] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [conflict, setConflict] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnflag, setConfirmUnflag] = useState<NoteDraft | null>(null);
  const base = useRef(note);
  const latest = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const saving = useRef(false);

  const showSaved = () => {
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => {
      setSaved(false);
    }, 2000);
  };

  /** Save what changed. `overwrite` re-sends after a conflict, trusting the newer updatedAt. */
  const save = async (overwrite?: Note) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (conflict && !overwrite) return;
    const current = overwrite ?? base.current;
    const d = latest.current;
    if (!hasContent(d)) {
      // Emptying a note reverts it: the stored note is unchanged.
      setDraft(noteToDraft(base.current));
      latest.current = noteToDraft(base.current);
      setEmpty(true);
      return;
    }
    setEmpty(false);
    const patch = diffDraft(current, d);
    if (!patch || saving.current) return;
    saving.current = true;
    try {
      const result = await update.mutateAsync({
        id: note.id,
        patch: { ...patch, expectedUpdatedAt: current.updatedAt },
      });
      base.current = result;
      setConflict(null);
      setError(null);
      showSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        const currentNote = e.details?.current as Note | undefined;
        if (currentNote) setConflict(currentNote);
      } else if (e instanceof ApiError && e.status < 500) {
        setError(e.message);
      } else {
        setError("Couldn't save that change. Your edit is still here.");
      }
    } finally {
      saving.current = false;
    }
  };

  const change = (next: NoteDraft) => {
    // Removing ? from a solved question with an answer asks first.
    if (latest.current.isQuestion && !next.isQuestion && base.current.question?.resolution) {
      setConfirmUnflag(next);
      return;
    }
    latest.current = next;
    setDraft(next);
    setEmpty(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save();
    }, AUTOSAVE_MS);
  };

  const finish = async () => {
    await save();
    onDone();
  };

  // Save when focus leaves the editor, and on the way out.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && el.contains(event.relatedTarget))) void save();
    };
    el.addEventListener('focusout', onOut);
    return () => {
      el.removeEventListener('focusout', onOut);
    };
  });

  // Clicking outside ends editing, except into the popovers and menus this editor opens.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || container.current?.contains(target)) return;
      if (
        target.closest(
          '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      void finish();
    };
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
    };
  });

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(savedTimer.current);
    },
    [],
  );

  return (
    <div ref={container} className="flex flex-col gap-2">
      <CaptureEditor
        value={draft}
        onChange={change}
        defaultGameDate={defaultGameDate}
        mode="edit"
        focusOnMount
        textareaRef={area}
        initialAction={initialAction}
        onSubmit={() => void finish()}
        onEscape={() => void finish()}
        actions={
          <>
            <span role="status" aria-live="polite" className="text-sm text-ink-muted">
              {saved ? 'Saved' : ''}
            </span>
            <button type="button" className="btn tap" onClick={() => void finish()}>
              Done
            </button>
          </>
        }
      />

      {empty ? (
        <p role="alert" className="text-sm text-danger">
          A note can&apos;t be empty. Delete it instead?{' '}
          <button
            type="button"
            className="tap underline"
            onClick={() => {
              remove.mutate(note);
              onDone();
            }}
          >
            Delete
          </button>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {conflict ? (
        <div role="alert" className="rounded-md border border-danger p-3 text-sm">
          <p className="font-semibold">This note changed in another window.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn tap"
              onClick={() => {
                base.current = conflict;
                const fresh = noteToDraft(conflict);
                latest.current = fresh;
                setDraft(fresh);
                setConflict(null);
              }}
            >
              Reload
            </button>
            <button
              type="button"
              className="btn tap"
              onClick={() => {
                const newer = conflict;
                setConflict(null);
                void save(newer);
              }}
            >
              Keep mine
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmUnflag !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmUnflag(null);
        }}
        title="Remove the question?"
        message="This note has an answer. Removing the ? flag clears the question and its answer."
        confirmLabel="Remove question"
        danger
        onConfirm={() => {
          if (confirmUnflag) {
            const next = confirmUnflag;
            setConfirmUnflag(null);
            latest.current = next;
            setDraft(next);
            void save();
          }
        }}
      />
    </div>
  );
}
