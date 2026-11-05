import { useRef } from 'react';
import { useApp } from '../app/context';
import { useStore } from '../app/store';
import type { SaveState } from '../editor/autosave';

export function describe(s: SaveState): string {
  if (s.kind === 'dirty') return 'Unsaved changes';
  if (s.kind === 'saving') return 'Saving…';
  if (s.kind === 'saved') return 'Saved';
  if (s.code === 'conflict') return 'Not saved: the note changed elsewhere';
  if (s.code === 'trashed') return 'Not saved: the note is in the Trash';
  return `Not saved: ${s.message}`;
}

export function SaveStatus() {
  const { model } = useApp();
  const save = useStore(model.store, (s) => s.save);
  const unsaved = useStore(model.store, (s) => s.unsaved);
  const hadError = useRef(false);

  // The live region speaks only errors and the recovery from one; "Saving…/Saved" every second would be noise.
  let announce = '';
  if (save.kind === 'error') {
    hadError.current = true;
    announce = describe(save);
  } else if (save.kind === 'saved' && hadError.current) {
    hadError.current = false;
    announce = 'Saved';
  }
  const pending = Object.entries(unsaved);

  return (
    <>
      <span>{describe(save)}</span>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      {save.kind === 'error' && save.code !== 'conflict' && save.code !== 'trashed' && (
        <button type="button" onClick={() => model.hooks.retry?.()}>
          Retry
        </button>
      )}
      {pending.length > 0 && (
        <span aria-label="Unsaved changes">
          Unsaved changes:{' '}
          {pending.map(([id, title]) => (
            <button key={id} type="button" onClick={() => model.openNote(id)}>
              {title}
            </button>
          ))}
        </span>
      )}
      <span className="muted">Sync: Not paired</span>
    </>
  );
}
