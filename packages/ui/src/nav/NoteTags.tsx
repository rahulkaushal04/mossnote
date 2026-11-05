import { useRef, useState, type FormEvent } from 'react';
import type { Client } from '../rpc/client';
import { useLoad } from './useLoad';

export interface NoteTagsProps {
  client: Client;
  noteId: string;
  /** Trashed notes: show the tags, offer no changes. */
  readOnly?: boolean;
}

/**
 * The tags on one note: chips with "Remove tag X", and an "Add tag" field that tags with an
 * existing tag (matched case-insensitively, suggestions via datalist) or creates the tag first.
 */
export function NoteTags({ client, noteId, readOnly }: NoteTagsProps) {
  const mine = useLoad(client, () => client.call('tags.forNote', { noteId }), ['tag', 'note']);
  const all = useLoad(client, () => client.call('tags.list'), ['tag']);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const listId = `tags-${noteId}`;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const name = input.current?.value.trim() ?? '';
    if (!name) return;
    const known = all.data?.find((t) => t.name.toLowerCase() === name.toLowerCase());
    let tagId = known?.id;
    if (!tagId) {
      const c = await client.call('tags.create', { name });
      if (!c.ok) return setErr(c.error.message);
      tagId = c.value.id;
    }
    const r = await client.call('tags.tagNote', { noteId, tagId });
    if (!r.ok) return setErr(r.error.message);
    setErr('');
    if (input.current) input.current.value = '';
  };
  const remove = async (tagId: string) => {
    const r = await client.call('tags.untagNote', { noteId, tagId });
    setErr(r.ok ? '' : r.error.message);
  };

  return (
    <div>
      <ul aria-label="Tags on this note">
        {(mine.data ?? []).map((t) => (
          <li key={t.id}>
            {t.name}
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove tag ${t.name}`}
                onClick={() => void remove(t.id)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {mine.status === 'error' && <p role="alert">Couldn’t load tags: {mine.error}</p>}
      {!readOnly && (
        <form onSubmit={(e) => void add(e)}>
          <input ref={input} aria-label="Add tag" list={listId} />
          <datalist id={listId}>
            {(all.data ?? []).map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          <button type="submit">Add</button>
        </form>
      )}
      {err && <p role="alert">{err}</p>}
    </div>
  );
}
