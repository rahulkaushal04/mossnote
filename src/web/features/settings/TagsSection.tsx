import { useState } from 'react';
import type { Tag } from '@shared/types';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ApiError } from '../../lib/api';
import { plural } from '../../lib/format';
import { useTagMutations, useTags } from '../tags/hooks';

const ACTION = 'tap rounded-control px-2 text-sm underline';
const REVEAL =
  'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100';

function usage(tag: Tag): string {
  const parts = [
    tag.counts.notes > 0 ? plural(tag.counts.notes, 'note') : null,
    tag.counts.people > 0 ? plural(tag.counts.people, 'person', 'people') : null,
    tag.counts.plantings > 0 ? plural(tag.counts.plantings, 'farm entry', 'farm entries') : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Not used';
}

/** Settings → Tags: rename inline, pin, merge, delete. */
export function TagsSection() {
  const tags = useTags();
  const actions = useTagMutations();
  const [renaming, setRenaming] = useState<{ tag: Tag; text: string } | null>(null);
  const [mergeInto, setMergeInto] = useState<{ source: Tag; target: Tag } | null>(null);
  const [merging, setMerging] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = tags.data ?? [];

  const commitRename = () => {
    if (!renaming) return;
    const { tag, text } = renaming;
    setRenaming(null);
    if (text.trim() === '' || text === tag.name) return;
    actions.rename.mutate(
      { id: tag.id, name: text },
      {
        onSuccess: () => {
          setError(null);
        },
        onError: (e) => {
          if (
            e instanceof ApiError &&
            e.code === 'conflict' &&
            typeof e.details?.existingId === 'string'
          ) {
            const target = list.find((t) => t.id === e.details?.existingId);
            if (target) setMergeInto({ source: tag, target });
          } else {
            setError(e.message);
          }
        },
      },
    );
  };

  if (list.length === 0) return <p className="text-ink-muted">Tags you use will appear here.</p>;

  return (
    <div>
      {error ? (
        <p role="alert" className="mb-2 text-danger">
          {error}
        </p>
      ) : null}
      <ul aria-label="Tags" className="m-0 list-none p-0">
        {list.map((tag) => (
          <li
            key={tag.id}
            className="group flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule py-2"
          >
            {renaming?.tag.id === tag.id ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  commitRename();
                }}
              >
                <label>
                  <span className="sr-only">New name for #{tag.name}</span>
                  <input
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- opens right after the user's own click
                    autoFocus
                    value={renaming.text}
                    onChange={(e) => {
                      setRenaming({ tag, text: e.target.value });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={commitRename}
                    className="tap w-48 rounded-control border border-ink-muted bg-paper px-2"
                  />
                </label>
              </form>
            ) : (
              <span className="font-semibold">
                #{tag.name}
                {tag.pinned ? (
                  <span className="ml-2 text-sm font-normal text-ink-muted">pinned</span>
                ) : null}
              </span>
            )}
            <span className="text-sm text-ink-muted">{usage(tag)}</span>
            <span className={`ml-auto flex flex-wrap ${REVEAL}`}>
              <button
                type="button"
                className={ACTION}
                aria-pressed={tag.pinned}
                aria-label={`${tag.pinned ? 'Unpin' : 'Pin'} #${tag.name}`}
                onClick={() => {
                  actions.pin.mutate({ id: tag.id, pinned: !tag.pinned });
                }}
              >
                {tag.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                type="button"
                className={ACTION}
                aria-label={`Rename #${tag.name}`}
                onClick={() => {
                  setRenaming({ tag, text: tag.name });
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className={ACTION}
                aria-label={`Merge #${tag.name}`}
                disabled={list.length < 2}
                onClick={() => {
                  setMerging(tag);
                }}
              >
                Merge
              </button>
              <button
                type="button"
                className={`${ACTION} text-danger`}
                aria-label={`Delete #${tag.name}`}
                onClick={() => {
                  setDeleting(tag);
                }}
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={mergeInto !== null}
        onOpenChange={(open) => {
          if (!open) setMergeInto(null);
        }}
        title={`Merge into #${mergeInto?.target.name ?? ''}?`}
        message={`#${mergeInto?.source.name ?? ''} will be merged into #${mergeInto?.target.name ?? ''}. Everything tagged with either keeps the one tag.`}
        confirmLabel="Merge"
        onConfirm={() => {
          if (mergeInto)
            actions.merge.mutate({ id: mergeInto.source.id, intoId: mergeInto.target.id });
        }}
      />

      {merging ? (
        <MergePicker
          source={merging}
          tags={list}
          onClose={() => {
            setMerging(null);
          }}
          onMerge={(target) => {
            actions.merge.mutate({ id: merging.id, intoId: target.id });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete #${deleting?.name ?? ''}?`}
        message={
          deleting
            ? `${usage(deleting) === 'Not used' ? 'It is not used anywhere.' : `It is used by ${usage(deleting)}.`} The tag is removed from them. Nothing else is deleted.`
            : ''
        }
        confirmLabel="Delete tag"
        danger
        onConfirm={() => {
          if (deleting) actions.remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

/** Pick which tag to merge into. A small inline panel, not a dialog stack. */
function MergePicker({
  source,
  tags,
  onClose,
  onMerge,
}: {
  source: Tag;
  tags: Tag[];
  onClose: () => void;
  onMerge: (target: Tag) => void;
}) {
  const [targetId, setTargetId] = useState('');
  const target = tags.find((t) => t.id === targetId);
  return (
    <div
      role="group"
      aria-label={`Merge #${source.name} into another tag`}
      className="mt-3 rounded-control border border-rule p-3"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Merge #{source.name} into</span>
        <select
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
          }}
          className="tap w-64 rounded-control border border-ink-muted bg-paper px-2"
        >
          <option value="">Choose a tag</option>
          {tags
            .filter((t) => t.id !== source.id)
            .map((t) => (
              <option key={t.id} value={t.id}>
                #{t.name}
              </option>
            ))}
        </select>
      </label>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="btn btn-primary tap"
          disabled={!target}
          onClick={() => {
            if (target) onMerge(target);
            onClose();
          }}
        >
          Merge
        </button>
        <button type="button" className="btn tap" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
