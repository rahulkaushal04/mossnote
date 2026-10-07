import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TrashItem } from '@shared/types';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api } from '../../lib/api';
import { invalidateEverywhere } from '../../lib/broadcast';
import { formatDateTime } from '../../lib/format';
import { ALL_DATA_KEYS, queryKeys } from '../../lib/queryKeys';
import { sentence } from '@shared/text';
import { useTerms } from './useLayout';

const KIND: Record<TrashItem['kind'], string> = {
  note: 'Note',
  person: 'Person',
  planting: 'Entry',
  map: 'Map',
};
const ACTION = 'tap rounded-control px-2 text-sm underline';

/** Settings → Recently deleted. Records are purged 30 days after deletion. */
export function TrashSection() {
  const client = useQueryClient();
  const trash = useQuery({ queryKey: queryKeys.trash, queryFn: api.trash });
  const terms = useTerms();
  const [forever, setForever] = useState<TrashItem | null>(null);
  const [emptying, setEmptying] = useState(false);
  const kindLabel = (kind: TrashItem['kind']): string =>
    kind === 'planting' ? sentence(terms.farm.one) : KIND[kind];
  const refresh = () => invalidateEverywhere(client, ALL_DATA_KEYS);
  const restore = useMutation({
    mutationFn: (item: TrashItem) => api.restoreFromTrash(item.kind, item.id),
    onSuccess: refresh,
  });
  const empty = useMutation({
    mutationFn: () => api.emptyTrash(),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (item: TrashItem) => api.deleteForever(item.kind, item.id),
    onSuccess: refresh,
  });

  const items = trash.data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="text-ink-muted">
        Nothing deleted. Anything you delete lands here for 30 days first.
      </p>
    );
  }
  return (
    <div>
      <p className="mb-2 text-sm text-ink-muted">
        Deleted records are removed for good after 30 days.
      </p>
      <div className="mb-2">
        <button
          type="button"
          className="btn tap text-sm"
          onClick={() => {
            setEmptying(true);
          }}
        >
          Delete everything here forever
        </button>
      </div>
      <ul aria-label="Recently deleted" className="m-0 list-none p-0">
        {items.map((item) => (
          <li
            key={`${item.kind}:${item.id}`}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule py-2"
          >
            <span className="text-sm text-ink-muted">{kindLabel(item.kind)}</span>
            <span className="min-w-0 flex-1 truncate">{item.label || '(untitled)'}</span>
            <time dateTime={item.deletedAt} className="text-sm text-ink-muted">
              {formatDateTime(item.deletedAt)}
            </time>
            <span className="flex">
              <button
                type="button"
                className={ACTION}
                aria-label={`Restore ${item.label || KIND[item.kind]}`}
                onClick={() => {
                  restore.mutate(item);
                }}
              >
                Restore
              </button>
              <button
                type="button"
                className={`${ACTION} text-danger`}
                aria-label={`Delete ${item.label || KIND[item.kind]} forever`}
                onClick={() => {
                  setForever(item);
                }}
              >
                Delete forever
              </button>
            </span>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={emptying}
        onOpenChange={setEmptying}
        title="Delete everything here forever?"
        message={`This removes all ${items.length} deleted records, and their tags and links, for good. It can't be undone.`}
        confirmLabel="Delete forever"
        danger
        onConfirm={() => {
          empty.mutate();
        }}
      />
      <ConfirmDialog
        open={forever !== null}
        onOpenChange={(open) => {
          if (!open) setForever(null);
        }}
        title="Delete forever?"
        message="This removes it, and its tags and links, for good. It can't be undone."
        confirmLabel="Delete forever"
        danger
        onConfirm={() => {
          if (forever) remove.mutate(forever);
        }}
      />
    </div>
  );
}
