import { useEffect, useRef, useState, type RefObject } from 'react';
import { ulid } from 'ulid';
import { LIMITS } from '@shared/constants';
import { formatCount } from '@shared/text';
import { api, ApiError } from '../../lib/api';
import { draftsAvailable, useDraft } from '../../lib/drafts';
import { modLabel } from '../../lib/hotkeys';
import { useCreateNote } from '../notes/hooks';
import { CaptureEditor } from './CaptureEditor';
import { QuickActions } from './QuickActions';
import {
  canSave,
  emptyDraft,
  isDraftEmpty,
  isNoteDraft,
  mergeDrafts,
  toCreateInput,
  withLink,
  type ChipLink,
  type NoteDraft,
} from './draft';

export interface ComposerProps {
  /** Draft scope: `home`, `day:<key>` or `quick` (spec section 5.1). */
  scope: string;
  /** The date new notes are stamped with: the current game date, or the viewed day. */
  defaultGameDate: number | null;
  focusOnMount?: boolean;
  onSaved?: () => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** Link chips to start with, for "Write about …". */
  presetLinks?: ChipLink[];
}

/**
 * Quick capture (spec section 5.1): a text box that saves with one shortcut and stays put. The
 * draft survives a refresh, the note appears in the list at once, and a failed save keeps the
 * text, shows an error, and retries with the same id so nothing is duplicated.
 */
export function Composer({
  scope,
  defaultGameDate,
  focusOnMount = false,
  onSaved,
  textareaRef,
  presetLinks,
}: ComposerProps) {
  const { draft, setDraft, clear, beginSave, settle, storageOk } = useDraft(
    scope,
    emptyDraft,
    isNoteDraft,
    isDraftEmpty,
    (d) => (presetLinks ?? []).reduce(withLink, d),
  );
  const create = useCreateNote();
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const area = textareaRef ?? ownRef;
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const failed = useRef<{ draft: NoteDraft; id: string } | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [warnedStorage] = useState(() => !draftsAvailable());

  // A draft stored with a pending id was being saved when the page went away. If that note
  // exists the save landed, so the draft is done; if not, the text is still here to save again.
  const pendingOnLoad = useRef(draft.pendingId);
  useEffect(() => {
    const id = pendingOnLoad.current;
    if (!id) return;
    let cancelled = false;
    api
      .getNote(id)
      .then(() => {
        if (!cancelled) clear();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clear]);

  const tooLong = draft.body.length > LIMITS.noteBody;
  const savable = canSave(draft) && !tooLong && !create.isPending;

  const send = (toSave: NoteDraft, id: string) => {
    setError(null);
    // The stored draft stays (tagged with this save's id) until the note is saved.
    beginSave({ ...toSave, pendingId: id });
    area.current?.focus();
    create.mutate(toCreateInput(toSave, id, defaultGameDate), {
      onSuccess: () => {
        failed.current = null;
        setRetryable(false);
        settle();
        setSaved(true);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => {
          setSaved(false);
        }, 1500);
        onSaved?.();
      },
      onError: (e) => {
        // Put the text back so nothing is lost, and remember the id for Retry.
        failed.current = { draft: toSave, id };
        setRetryable(true);
        // Put the text back. Anything typed meanwhile is kept below it.
        setDraft(isDraftEmpty(draftRef.current) ? toSave : mergeDrafts(toSave, draftRef.current));
        setError(
          e instanceof ApiError && e.code !== 'internal'
            ? e.message
            : "Couldn't save. Your text is still here.",
        );
      },
    });
  };

  const submit = () => {
    if (!savable) return;
    send(draft, ulid());
  };

  const retry = () => {
    const attempt = failed.current;
    if (attempt) send(attempt.draft, attempt.id);
  };

  return (
    <section aria-label="New note" className="rounded-panel bg-surface p-4">
      <QuickActions
        value={draft}
        onChange={(next) => {
          setDraft({ ...next, pendingId: undefined });
        }}
      />
      <CaptureEditor
        value={draft}
        onChange={(next) => {
          setDraft({ ...next, pendingId: undefined });
        }}
        defaultGameDate={defaultGameDate}
        mode="compose"
        onSubmit={submit}
        focusOnMount={focusOnMount}
        textareaRef={area}
        describedBy={error || tooLong ? 'composer-message' : undefined}
        actions={
          <button
            type="button"
            className="btn btn-primary tap"
            disabled={!savable}
            onClick={submit}
          >
            Save
            <span className="text-sm opacity-80" aria-hidden="true">
              {modLabel()}↵
            </span>
          </button>
        }
      />
      <div id="composer-message" className="mt-2 text-sm">
        {tooLong ? (
          <p role="alert" className="text-danger">
            Too long: {formatCount(draft.body.length)} of {formatCount(LIMITS.noteBody)} characters.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-danger">
            {error}{' '}
            {retryable ? (
              <button type="button" className="tap underline" onClick={retry}>
                Retry
              </button>
            ) : null}
          </p>
        ) : null}
        {!storageOk || warnedStorage ? (
          <p role="status" className="text-ink-muted">
            Drafts won&apos;t be kept in this browser.
          </p>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {saved ? 'Saved' : ''}
      </p>
    </section>
  );
}
