import { useRef, useState, type FormEvent } from 'react';
import type { Tag } from '@mossnote/core/rpc';
import { useStore } from '../app/store';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import type { Client } from '../rpc/client';
import type { NavStore } from './navStore';
import { useLoad } from './useLoad';

export interface TagListProps {
  client: Client;
  nav: NavStore;
}

interface Merge {
  tag: Tag;
  name: string;
  into: Tag;
}

/**
 * All tags: select one to filter notes, create a tag, rename a tag inline (Enter saves, Esc
 * cancels). Renaming to the name of another tag never merges on its own: core answers
 * `needsMerge`, a ConfirmDialog explains the merge, and only its confirm button sends
 * `confirmMerge: true`.
 */
export function TagList({ client, nav }: TagListProps) {
  const tags = useLoad(client, () => client.call('tags.list'), ['tag']);
  const selKind = useStore(nav, (s) => s.kind);
  const selId = useStore(nav, (s) => s.id);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [merge, setMerge] = useState<Merge | null>(null);
  const [err, setErr] = useState('');
  const newRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const name = newRef.current?.value.trim() ?? '';
    if (!name) return setErr('A tag needs a name.');
    const r = await client.call('tags.create', { name });
    if (!r.ok) return setErr(r.error.message);
    setErr('');
    if (newRef.current) newRef.current.value = '';
  };
  const rename = async (tag: Tag, raw: string, confirmMerge = false) => {
    const name = raw.trim();
    if (!name) return setErr('A tag needs a name.');
    if (name === tag.name) return setRenaming(null);
    const r = await client.call('tags.rename', {
      id: tag.id,
      name,
      ...(confirmMerge ? { confirmMerge: true as const } : {}),
    });
    if (!r.ok) {
      done.current = false;
      return setErr(r.error.message);
    }
    setErr('');
    setRenaming(null);
    if (r.value.kind === 'needsMerge') setMerge({ tag, name, into: r.value.into });
    else if (r.value.kind === 'merged' && selKind === 'tag' && selId === tag.id)
      nav.select({ kind: 'tag', id: r.value.tag.id });
  };

  return (
    <section aria-labelledby="tags-h">
      <h2 id="tags-h">Tags</h2>
      {tags.status === 'error' ? (
        <div role="alert">
          <p>Couldn’t load tags: {tags.error}</p>
          <button type="button" onClick={() => void tags.reload()}>
            Retry
          </button>
        </div>
      ) : tags.status === 'loading' ? (
        <p className="muted">Loading tags…</p>
      ) : tags.data!.length === 0 ? (
        <p className="muted">No tags yet. Add one below.</p>
      ) : (
        <ul aria-label="Tags">
          {tags.data!.map((t) => (
            <li key={t.id}>
              {renaming === t.id ? (
                <input
                  autoFocus
                  defaultValue={t.name}
                  aria-label={`Rename tag ${t.name}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      done.current = true;
                      void rename(t, e.currentTarget.value);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      done.current = true;
                      setErr('');
                      setRenaming(null);
                    }
                  }}
                  onBlur={(e) => {
                    if (!done.current) {
                      done.current = true;
                      void rename(t, e.currentTarget.value);
                    }
                  }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    aria-current={selKind === 'tag' && selId === t.id ? 'true' : undefined}
                    onClick={() => nav.select({ kind: 'tag', id: t.id })}
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Rename tag ${t.name}`}
                    onClick={() => {
                      done.current = false;
                      setErr('');
                      setRenaming(t.id);
                    }}
                  >
                    Rename
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void create(e)}>
        <label>
          New tag <input ref={newRef} />
        </label>
        <button type="submit">Add tag</button>
      </form>
      {err && <p role="alert">{err}</p>}
      {merge && (
        <ConfirmDialog
          title={`Merge tag "${merge.tag.name}" into "${merge.into.name}"?`}
          description={`A tag named "${merge.into.name}" already exists. Merging moves every note tagged "${merge.tag.name}" to "${merge.into.name}" and removes "${merge.tag.name}". This cannot be undone.`}
          confirmLabel="Merge tags"
          onCancel={() => setMerge(null)}
          onConfirm={async () => {
            await rename(merge.tag, merge.name, true);
            setMerge(null);
          }}
        />
      )}
    </section>
  );
}
