import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../app/context';
import { useStore } from '../app/store';
import { useLoad } from '../nav/useLoad';
import { BulkBar } from '../portability/BulkBar';
import { selectionClick, selectionKey } from '../portability/selection';
import { FilterBar } from './FilterBar';
import { Highlighted } from './Highlighted';
import { SaveSearchDialog } from './SavedSearches';
import type { SearchHit } from './searchStore';
import './search.css';

const hitId = (id: string) => `search-hit-${id}`;

const Row = memo(function Row({
  hit,
  selected,
  active,
  selecting,
  checked,
}: {
  hit: SearchHit;
  selected: boolean;
  active: boolean;
  selecting: boolean;
  checked: boolean;
}) {
  return (
    <li
      role="option"
      id={hitId(hit.noteId)}
      data-id={hit.noteId}
      aria-selected={selecting ? checked : selected}
      tabIndex={active ? 0 : -1}
    >
      {selecting && (
        <span className="sel-mark" aria-hidden="true">
          {checked ? '☑' : '☐'}
        </span>
      )}
      <span className="hit-title">
        {hit.title.text ? <Highlighted value={hit.title} /> : 'Untitled'}
      </span>
      {hit.snippet.text && (
        <span className="hit-snippet">
          <Highlighted value={hit.snippet} />
        </span>
      )}
    </li>
  );
});

/** The search box on top of the notes pane. While the query is non-empty, results replace `children` (the note list). */
export function SearchPane({ children }: { children: ReactNode }) {
  const { model, registry } = useApp();
  const search = model.search;
  const s = useStore(search, (x) => x);
  const navKind = useStore(model.nav, (x) => x.kind);
  const navId = useStore(model.nav, (x) => x.id);
  const openId = useStore(model.store, (x) => x.openId);
  const tags = useLoad(model.client, () => model.client.call('tags.list'), ['tag']);
  const folders = useLoad(model.client, () => model.client.call('folders.list'), ['folder']);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const scopeId = useId();
  const hintId = useId();
  const listId = useId();
  const query = s.query.trim();
  const live = query !== '';

  useEffect(() => {
    search.hooks.focusInput = () => {
      input.current?.focus();
      input.current?.select();
    };
    return () => void (search.hooks.focusInput = undefined);
  }, [search]);

  const scopeLabel =
    navKind === 'all'
      ? 'All notes'
      : navKind === 'trash'
        ? 'Trash'
        : navKind === 'favorites'
          ? 'Favorites'
          : navKind === 'folder'
            ? `Folder “${folders.data?.find((f) => f.id === navId)?.name ?? '…'}”`
            : `Tag “${tags.data?.find((t) => t.id === navId)?.name ?? '…'}”`;

  const hits = s.hits;
  const selecting = useStore(model.selection, (x) => x.on);
  const picked = useStore(model.selection, (x) => x.ids);
  const order = useMemo(() => hits.map((h) => h.noteId), [hits]);
  const active =
    (activeId && hits.some((h) => h.noteId === activeId) && activeId) ||
    (openId && hits.some((h) => h.noteId === openId) && openId) ||
    hits[0]?.noteId;

  // A focused row can vanish (note trashed or purged elsewhere): do not drop focus to <body>.
  const hadFocus = useRef(false);
  useEffect(() => {
    if (hadFocus.current && document.activeElement === document.body) {
      if (active) document.getElementById(hitId(active))?.focus();
      else input.current?.focus();
    }
    hadFocus.current = !!results.current?.querySelector('[role=option]:focus');
  });

  const clear = () => {
    search.clear();
    input.current?.focus();
  };
  const move = (id: string | undefined) => {
    if (!id) return;
    setActiveId(id);
    document.getElementById(hitId(id))?.focus();
  };
  const onListKey = (e: React.KeyboardEvent) => {
    const i = hits.findIndex((h) => h.noteId === active);
    const row = (e.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id') ?? active;
    const sk = selectionKey(model.selection, order, active, row ?? null, e);
    if (sk) {
      if (sk.moveTo) move(sk.moveTo);
    } else if (selecting && e.key === 'Delete' && picked.size > 0) registry.run('bulk.trash');
    else if (e.key === 'ArrowDown') move(hits[Math.min(hits.length - 1, i + 1)]?.noteId);
    else if (e.key === 'ArrowUp') {
      if (i <= 0) input.current?.focus();
      else move(hits[i - 1]?.noteId);
    } else if (e.key === 'Home') move(hits[0]?.noteId);
    else if (e.key === 'End') move(hits[hits.length - 1]?.noteId);
    else if (e.key === 'Enter' && row) {
      model.openNote(row);
      model.hooks.focusEditor?.();
    } else if (e.key === 'Escape') clear();
    else return;
    e.preventDefault();
  };

  return (
    <div className="search-pane">
      <div role="search" aria-label="Search notes" className="search-box">
        <label htmlFor="search-input" className="sr-only">
          Search notes
        </label>
        <input
          id="search-input"
          ref={input}
          type="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={1000}
          placeholder="Search notes"
          value={s.query}
          aria-describedby={`${scopeId} ${hintId}`}
          {...(live && hits.length ? { 'aria-controls': listId } : {})}
          onChange={(e) => search.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && s.query) {
              e.preventDefault();
              e.stopPropagation();
              clear();
            } else if (e.key === 'ArrowDown' && hits.length) {
              e.preventDefault();
              results.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
            }
          }}
        />
        <p id={scopeId} className="muted search-scope">
          Searching in: {scopeLabel}
        </p>
        <p id={hintId} className="muted search-hint" hidden={live}>
          Use “quotes” for a phrase, word* for a prefix, -word to exclude, tag:name or folder:name.
        </p>
      </div>
      <div role="status" className="search-status">
        {s.announce}
      </div>
      {!live ? (
        children
      ) : (
        <>
          <FilterBar
            tags={tags.data ?? []}
            folders={folders.data ?? []}
            filters={s.filters}
            sort={s.sort}
            dir={s.dir}
            onFilters={(p) => search.setFilters(p)}
            onSort={(a, b) => search.setSort(a, b)}
            onSave={() => setSaving(true)}
          />
          <div ref={results} className="search-results" aria-busy={s.status === 'loading'}>
            {s.status === 'indexError' ? (
              <div className="pane-msg" role="alert">
                <p>The search index is unavailable.</p>
                <p className="search-index-error">{s.error}</p>
                <button type="button" onClick={() => void search.rebuild()}>
                  Retry
                </button>
              </div>
            ) : s.status === 'error' ? (
              <div className="pane-msg" role="alert">
                <p>Search failed: {s.error}</p>
                <button type="button" onClick={() => search.retry()}>
                  Retry
                </button>
              </div>
            ) : s.status === 'rebuilding' ? (
              <div className="pane-msg">
                <p>
                  Rebuilding the search index…
                  {s.progress ? ` ${s.progress.done} of ${s.progress.total} notes` : ''}
                </p>
                {s.progress && (
                  <progress
                    aria-label="Search index rebuild progress"
                    value={s.progress.done}
                    max={Math.max(1, s.progress.total)}
                  />
                )}
              </div>
            ) : (
              <>
                {s.status === 'loading' && hits.length === 0 && (
                  <p className="pane-msg muted">Searching…</p>
                )}
                {s.status === 'ready' && hits.length === 0 && (
                  <p className="pane-msg">No notes match “{query}”.</p>
                )}
                {s.messages.length > 0 && (
                  <ul className="search-messages" aria-label="Search messages">
                    {s.messages.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                )}
                {hits.length > 0 && (
                  <>
                    <BulkBar order={order} />
                    <ul
                      id={listId}
                      role="listbox"
                      aria-label="Search results"
                      className="notelist search-list"
                      {...(selecting ? { 'aria-multiselectable': true } : {})}
                      onKeyDown={onListKey}
                      onClick={(e) => {
                        const id = (e.target as HTMLElement)
                          .closest('[data-id]')
                          ?.getAttribute('data-id');
                        if (id) {
                          setActiveId(id);
                          if (!selectionClick(model.selection, order, id, e)) model.openNote(id);
                        }
                      }}
                    >
                      {hits.map((h) => (
                        <Row
                          key={h.noteId}
                          hit={h}
                          selected={h.noteId === openId}
                          active={h.noteId === active}
                          selecting={selecting}
                          checked={picked.has(h.noteId)}
                        />
                      ))}
                    </ul>
                  </>
                )}
                {s.hasMore && (
                  <button type="button" onClick={() => void search.loadMore()}>
                    Load more
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
      {saving && (
        <SaveSearchDialog
          title="Save search"
          initial={query}
          onCancel={() => setSaving(false)}
          onSubmit={async (name) => {
            const r = await model.client.call('search.saved.create', { name, spec: search.spec() });
            if (!r.ok) return r.error.message;
            setSaving(false);
            void search.loadSaved();
          }}
        />
      )}
    </div>
  );
}
