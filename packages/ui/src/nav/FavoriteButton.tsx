import { useState } from 'react';
import type { NoteSummary } from '@mossnote/core/rpc';
import type { Client } from '../rpc/client';

export interface FavoriteButtonProps {
  client: Client;
  noteId: string;
  /** Controlled: pass the note's current `favorite`; it updates when the list refreshes. */
  favorite: boolean;
  disabled?: boolean;
  onChange?(note: NoteSummary): void;
}

/** The favorites toggle (`aria-pressed`). Also backs the `note.favorite` command. */
export function FavoriteButton({
  client,
  noteId,
  favorite,
  disabled,
  onChange,
}: FavoriteButtonProps) {
  const [err, setErr] = useState('');
  return (
    <>
      <button
        type="button"
        aria-pressed={favorite}
        disabled={disabled}
        onClick={async () => {
          const r = await client.call('notes.setFavorite', { id: noteId, favorite: !favorite });
          if (r.ok) {
            setErr('');
            onChange?.(r.value);
          } else setErr(r.error.message);
        }}
      >
        Favorite
      </button>
      {err && <span role="alert">{err}</span>}
    </>
  );
}
