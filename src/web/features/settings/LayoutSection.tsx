import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SectionId } from '@shared/templates';
import { REQUEST_TEMPLATE_URL } from '@shared/links';
import {
  ALWAYS_VISIBLE,
  DEFAULT_LAYOUT,
  type Layout,
  type ResolvedSection,
} from '@shared/templates';
import { NewJournalDialog } from '../journals/JournalDialogs';
import { api } from '../../lib/api';
import { invalidateEverywhere } from '../../lib/broadcast';
import { ALL_DATA_KEYS } from '../../lib/queryKeys';
import { useTags } from '../tags/hooks';
import { useLayout, useSections, useTemplate } from './useLayout';
import { useUpdateSettings } from './useSettings';

const SMALL = 'btn tap text-sm';

function SectionRow({
  section,
  first,
  last,
  onRename,
  onHide,
  onMove,
}: {
  section: ResolvedSection;
  first: boolean;
  last: boolean;
  onRename: (name: string) => void;
  onHide: (hidden: boolean) => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const [name, setName] = useState(section.label);
  const locked = ALWAYS_VISIBLE.includes(section.id);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule py-2">
      <label className="flex min-w-40 flex-1 flex-col text-sm">
        <span className="sr-only">Name of {section.templateLabel}</span>
        <input
          value={name}
          maxLength={30}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed === '') setName(section.templateLabel);
            if (trimmed !== section.label)
              onRename(trimmed === '' ? section.templateLabel : trimmed);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="tap rounded-control border border-ink-muted bg-paper px-3"
        />
      </label>
      <label className="tap flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!section.hidden}
          disabled={locked}
          onChange={(e) => {
            onHide(!e.target.checked);
          }}
          className="size-4 accent-accent"
        />
        Show
      </label>
      <span className="flex gap-1">
        <button
          type="button"
          className={SMALL}
          aria-label={`Move ${section.label} up`}
          disabled={first}
          onClick={() => {
            onMove(-1);
          }}
        >
          ↑
        </button>
        <button
          type="button"
          className={SMALL}
          aria-label={`Move ${section.label} down`}
          disabled={last}
          onClick={() => {
            onMove(1);
          }}
        >
          ↓
        </button>
      </span>
    </li>
  );
}

/**
 * Settings → Template and sections: the journal's template (chosen when it was made), then
 * rename, hide and reorder the sections it gives you.
 */
export function LayoutSection() {
  const client = useQueryClient();
  const layout = useLayout();
  const sections = useSections();
  const template = useTemplate();
  const tags = useTags();
  const update = useUpdateSettings();
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const save = (next: Layout) => {
    setMessage(null);
    update.mutate(
      { layout: next },
      {
        onError: () => {
          setMessage("Couldn't save that change. It was undone.");
        },
      },
    );
  };
  const current = (): Layout => ({
    ...layout,
    order: sections.map((s) => s.id),
  });

  const move = (id: SectionId, delta: -1 | 1) => {
    const order = sections.map((s) => s.id);
    const from = order.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= order.length) return;
    order.splice(to, 0, ...order.splice(from, 1));
    save({ ...layout, order });
  };
  const rename = (id: SectionId, name: string) => {
    const original = sections.find((s) => s.id === id)?.templateLabel;
    const others = Object.entries(layout.labels).filter(([key]) => key !== id);
    const labels = Object.fromEntries(name === original ? others : [...others, [id, name]]);
    save({ ...current(), labels });
  };
  const hide = (id: SectionId, hidden: boolean) => {
    const set = new Set(layout.hidden);
    if (hidden) set.add(id);
    else set.delete(id);
    save({ ...current(), hidden: [...set] });
  };

  const existing = new Set((tags.data ?? []).map((t) => t.name.toLowerCase()));
  const addSuggested = async (name: string) => {
    setMessage(null);
    try {
      const tag = await api.createTag(name);
      await api.patchTag(tag.id, { pinned: true });
      await invalidateEverywhere(client, ALL_DATA_KEYS);
    } catch {
      setMessage("Couldn't add that tag.");
    }
  };

  return (
    <>
      <div>
        <h3 className="font-semibold">Template</h3>
        <p className="mt-1">
          <strong>{template.name}</strong>
          <span className="block text-sm text-ink-muted">{template.about}</span>
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          A journal keeps the template it was made with. To use another one, make a new journal
          beside this one. A template changes wording and adds shortcuts; it never adds any facts
          about a game.
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            className="btn tap"
            onClick={() => {
              setCreating(true);
            }}
          >
            New journal…
          </button>
          <a href={REQUEST_TEMPLATE_URL} target="_blank" rel="noreferrer noopener">
            Request a template
          </a>
        </p>
        <NewJournalDialog open={creating} onOpenChange={setCreating} />
      </div>

      <div>
        <h3 className="font-semibold">Sections</h3>
        <p className="text-sm text-ink-muted">
          Rename, hide or reorder what appears in the menu. Today and Journal always stay.
        </p>
        <ul aria-label="Sections" className="m-0 mt-2 list-none p-0">
          {sections.map((section, i) => (
            <SectionRow
              key={`${section.id}-${section.label}-${section.hidden ? 'h' : 's'}`}
              section={section}
              first={i === 0}
              last={i === sections.length - 1}
              onRename={(name) => {
                rename(section.id, name);
              }}
              onHide={(hidden) => {
                hide(section.id, hidden);
              }}
              onMove={(delta) => {
                move(section.id, delta);
              }}
            />
          ))}
        </ul>
      </div>

      {template.quickActions.length > 0 ? (
        <label className="tap flex items-center gap-2">
          <input
            type="checkbox"
            checked={layout.quickActions}
            onChange={(e) => {
              save({ ...current(), quickActions: e.target.checked });
            }}
            className="size-4 accent-accent"
          />
          Show quick actions above the note box
        </label>
      ) : null}

      {template.suggestedTags.some((name) => !existing.has(name.toLowerCase())) ? (
        <div>
          <h3 className="font-semibold">Extra sections</h3>
          <p className="text-sm text-ink-muted">
            A pinned tag appears in the menu as its own section. Add one with a click.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {template.suggestedTags
              .filter((name) => !existing.has(name.toLowerCase()))
              .map((name) => (
                <button
                  key={name}
                  type="button"
                  className="btn tap"
                  onClick={() => void addSuggested(name)}
                >
                  Add “{name}”
                </button>
              ))}
          </div>
        </div>
      ) : null}

      <div>
        <button
          type="button"
          className="btn tap"
          onClick={() => {
            save({ ...DEFAULT_LAYOUT, template: layout.template });
          }}
        >
          Reset sections to the template&apos;s defaults
        </button>
      </div>
      {message ? (
        <p role="alert" className="text-danger">
          {message}
        </p>
      ) : null}
    </>
  );
}
