import type { Folder, Tag } from '@mossnote/core/rpc';
import { NO_FILTERS, type SearchState, type UiFilters } from './searchStore';

export interface FilterBarProps {
  tags: Tag[];
  folders: Folder[];
  filters: UiFilters;
  sort: SearchState['sort'];
  dir: SearchState['dir'];
  onFilters(p: Partial<UiFilters>): void;
  onSort(sort: SearchState['sort'], dir?: SearchState['dir']): void;
  onSave(): void;
}

const SORTS: [SearchState['sort'], string][] = [
  ['relevance', 'Relevance'],
  ['updated', 'Last updated'],
  ['created', 'Created'],
  ['title', 'Title'],
];

export function FilterBar({
  tags,
  folders,
  filters: f,
  sort,
  dir,
  onFilters,
  onSort,
  onSave,
}: FilterBarProps) {
  const dirty = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
  const date = (label: string, k: keyof UiFilters) => (
    <label>
      {label}
      <input
        type="date"
        value={String(f[k])}
        onChange={(e) => onFilters({ [k]: e.target.value })}
      />
    </label>
  );
  return (
    <div role="group" aria-label="Search filters" className="search-filters">
      <label className="inline">
        <input
          type="checkbox"
          checked={f.favorite}
          onChange={(e) => onFilters({ favorite: e.target.checked })}
        />
        Favorites only
      </label>
      <label>
        Tag
        <select
          value={f.tagIds.length === 1 ? f.tagIds[0] : ''}
          onChange={(e) => onFilters({ tagIds: e.target.value ? [e.target.value] : [] })}
        >
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {(f.tagIds.length > 1 || f.folderIds.length > 0) && (
        <ul aria-label="Applied filters" className="search-chips">
          {f.tagIds.map((id) => (
            <li key={`t${id}`}>
              Tag {tags.find((t) => t.id === id)?.name ?? id}
              <button
                type="button"
                aria-label={`Remove tag filter ${tags.find((t) => t.id === id)?.name ?? id}`}
                onClick={() => onFilters({ tagIds: f.tagIds.filter((x) => x !== id) })}
              >
                ×
              </button>
            </li>
          ))}
          {f.folderIds.map((id) => (
            <li key={`f${id}`}>
              Folder {folders.find((x) => x.id === id)?.name ?? id}
              <button
                type="button"
                aria-label={`Remove folder filter ${folders.find((x) => x.id === id)?.name ?? id}`}
                onClick={() => onFilters({ folderIds: f.folderIds.filter((x) => x !== id) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {date('Created from', 'createdFrom')}
      {date('Created to', 'createdTo')}
      {date('Updated from', 'updatedFrom')}
      {date('Updated to', 'updatedTo')}
      <label>
        Sort by
        <select value={sort} onChange={(e) => onSort(e.target.value as SearchState['sort'])}>
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Order
        <select
          value={dir}
          disabled={sort === 'relevance'}
          onChange={(e) => onSort(sort, e.target.value as SearchState['dir'])}
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </label>
      {dirty && (
        <button type="button" onClick={() => onFilters(NO_FILTERS)}>
          Clear filters
        </button>
      )}
      <button type="button" onClick={onSave}>
        Save search
      </button>
    </div>
  );
}
