import { useState } from 'react';
import { CloseIcon, SparkIcon } from '../../components/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/Popover';
import { useTags } from '../tags/hooks';
import type { FlagFilter, JournalFilters, QuestionState } from './useJournalFilters';

const SEGMENT =
  'tap px-3 text-sm first:rounded-l-control last:rounded-r-control border border-ink-muted -ml-px first:ml-0 aria-checked:bg-accent aria-checked:text-accent-ink aria-checked:border-accent hover:bg-surface aria-checked:hover:bg-accent';

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: React.ReactNode; name: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.name}
          className={SEGMENT}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function TagPicker({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (name: string) => void;
}) {
  const tags = useTags();
  const [q, setQ] = useState('');
  const list = (tags.data ?? []).filter((t) =>
    t.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="btn tap text-sm">
          Tag
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Find a tag</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
            className="tap rounded-control border border-ink-muted bg-paper px-2"
          />
        </label>
        {list.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No tags match.</p>
        ) : (
          <ul className="m-0 mt-2 max-h-60 list-none overflow-y-auto p-0">
            {list.map((tag) => (
              <li key={tag.id}>
                <label className="tap flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.some((s) => s.toLowerCase() === tag.name.toLowerCase())}
                    onChange={() => {
                      onToggle(tag.name);
                    }}
                    className="size-4 accent-accent"
                  />
                  #{tag.name}
                </label>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The Journal's filter row (spec section 5.5). Wraps on wide screens, scrolls sideways on narrow. */
export function FilterBar({
  filters,
  onChange,
}: {
  filters: JournalFilters;
  onChange: (next: Partial<JournalFilters>) => void;
}) {
  const tags = useTags();
  const pinned = (tags.data ?? []).filter((t) => t.pinned).slice(0, 8);
  const has = (name: string) => filters.tags.some((t) => t.toLowerCase() === name.toLowerCase());
  const toggleTag = (name: string) => {
    onChange({
      tags: has(name)
        ? filters.tags.filter((t) => t.toLowerCase() !== name.toLowerCase())
        : [...filters.tags, name],
    });
  };

  return (
    <div
      className="flex items-center gap-3 overflow-x-auto py-3 wide:flex-wrap wide:overflow-visible"
      role="group"
      aria-label="Journal filters"
    >
      <Segmented<FlagFilter>
        label="Show"
        value={filters.flag}
        options={[
          { value: 'all', name: 'All', label: 'All' },
          {
            value: 'discovery',
            name: 'Discoveries',
            label: (
              <span className="inline-flex items-center gap-1">
                <SparkIcon className="text-discovery" /> Discoveries
              </span>
            ),
          },
          {
            value: 'question',
            name: 'Questions',
            label: (
              <span className="inline-flex items-center gap-1">
                <span className="font-semibold text-question">?</span> Questions
              </span>
            ),
          },
        ]}
        onChange={(flag) => {
          onChange({ flag, ...(flag === 'question' ? { state: 'open' } : {}) });
        }}
      />
      {filters.flag === 'question' ? (
        <Segmented<QuestionState>
          label="Question state"
          value={filters.state}
          options={[
            { value: 'open', name: 'Open', label: 'Open' },
            { value: 'solved', name: 'Solved', label: 'Solved' },
            { value: 'all', name: 'All questions', label: 'All' },
          ]}
          onChange={(state) => {
            onChange({ state });
          }}
        />
      ) : null}
      <TagPicker selected={filters.tags} onToggle={toggleTag} />
      {filters.tags.map((tag) => (
        <button
          key={tag}
          type="button"
          className="tap inline-flex items-center gap-1 rounded-control border border-rule px-2 text-sm"
          aria-label={`Remove tag filter ${tag}`}
          onClick={() => {
            toggleTag(tag);
          }}
        >
          #{tag} <CloseIcon />
        </button>
      ))}
      {pinned
        .filter((t) => !has(t.name))
        .map((tag) => (
          <button
            key={tag.id}
            type="button"
            aria-pressed={false}
            className="tap rounded-control border border-rule px-2 text-sm text-ink-muted hover:bg-surface"
            onClick={() => {
              toggleTag(tag.name);
            }}
          >
            #{tag.name}
          </button>
        ))}
      <button
        type="button"
        aria-pressed={filters.undated}
        className="btn tap text-sm aria-pressed:bg-surface aria-pressed:font-semibold"
        onClick={() => {
          onChange({ undated: !filters.undated });
        }}
      >
        Not dated
      </button>
      <button
        type="button"
        aria-pressed={filters.order === 'asc'}
        className="btn tap ml-auto text-sm"
        onClick={() => {
          onChange({ order: filters.order === 'asc' ? 'desc' : 'asc' });
        }}
      >
        {filters.order === 'asc' ? 'Oldest first' : 'Newest first'}
      </button>
    </div>
  );
}
