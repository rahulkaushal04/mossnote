import { useState } from 'react';
import { Chip } from '../../components/ui/Chip';
import { CloseIcon, FilterIcon, SparkIcon } from '../../components/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/Popover';
import { useTags } from '../tags/hooks';
import type { FlagFilter, JournalFilters, QuestionState } from './useJournalFilters';

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
    <div role="radiogroup" aria-label={label} className="segmented shrink-0">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.name}
          className="segmented-option"
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
        <button type="button" className="chip chip-toggle shrink-0">
          <FilterIcon className="size-4" />
          Tag
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Find a tag</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
            className="field-input"
          />
        </label>
        {list.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No tags match.</p>
        ) : (
          <ul className="m-0 mt-2 max-h-60 list-none overflow-y-auto p-0">
            {list.map((tag) => (
              <li key={tag.id}>
                <label className="flex min-h-11 items-center gap-2">
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

/** The Journal's filter row. Wraps on wide screens, scrolls sideways on narrow. */
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
      className="scroll-row -mx-4 flex items-center gap-2 overflow-x-auto px-4 py-3 phone:mx-0 phone:flex-wrap phone:overflow-visible phone:px-0"
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
          className="chip chip-toggle chip-selected shrink-0"
          aria-label={`Remove tag filter ${tag}`}
          onClick={() => {
            toggleTag(tag);
          }}
        >
          #{tag} <CloseIcon className="size-3.5" />
        </button>
      ))}
      {pinned
        .filter((t) => !has(t.name))
        .map((tag) => (
          <Chip
            key={tag.id}
            selected={false}
            className="shrink-0"
            onToggle={() => {
              toggleTag(tag.name);
            }}
          >
            #{tag.name}
          </Chip>
        ))}
      <Chip
        selected={filters.undated}
        className="shrink-0"
        onToggle={() => {
          onChange({ undated: !filters.undated });
        }}
      >
        Not dated
      </Chip>
      <button
        type="button"
        aria-pressed={filters.order === 'asc'}
        className="btn btn-ghost ml-auto shrink-0"
        onClick={() => {
          onChange({ order: filters.order === 'asc' ? 'desc' : 'asc' });
        }}
      >
        {filters.order === 'asc' ? 'Oldest first' : 'Newest first'}
      </button>
    </div>
  );
}
