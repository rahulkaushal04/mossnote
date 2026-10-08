import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { normalizeTag } from '@shared/tags';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { TagList } from '../../features/notes/NoteParts';

/** Tags on a person or farm entry: chips with remove, and an input that suggests existing tags. */
export function TagEditor({
  tags,
  onChange,
  linkBase,
}: {
  tags: readonly string[];
  onChange: (tags: string[]) => void;
  /** Where a tag links to: the list filtered by that tag. */
  linkBase: string;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const query = text.trim().replace(/^#+/, '');
  const suggestions = useQuery({
    queryKey: queryKeys.pick('tag', query),
    queryFn: ({ signal }) => api.pick('tag', query, [], signal),
    enabled: text !== '',
  });

  const add = (raw: string) => {
    const result = normalizeTag(raw);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    if (!tags.some((t) => t.toLowerCase() === result.name.toLowerCase()))
      onChange([...tags, result.name]);
    setText('');
  };

  return (
    <div className="flex flex-col gap-2">
      <TagList
        tags={tags}
        to={(tag) => `${linkBase}?tag=${encodeURIComponent(tag)}`}
        onRemove={(tag) => {
          onChange(tags.filter((t) => t !== tag));
        }}
      />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Add a tag</span>
        <input
          list={listId}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${listId}-error` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim() !== '') {
              e.preventDefault();
              add(text);
            }
          }}
          className="field-input w-64 max-w-full"
        />
        <datalist id={listId}>
          {(suggestions.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.label} />
          ))}
        </datalist>
        {error ? (
          <span id={`${listId}-error`} role="alert" className="text-danger">
            {error}
          </span>
        ) : null}
      </label>
    </div>
  );
}
