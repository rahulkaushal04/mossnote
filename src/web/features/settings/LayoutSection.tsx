import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SectionId } from '@shared/templates';
import {
  ALWAYS_VISIBLE,
  DEFAULT_LAYOUT,
  TEMPLATES,
  type Layout,
  type ResolvedSection,
} from '@shared/templates';
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
 * Settings → Game and sections: pick a template, then rename, hide and reorder the sections it
 * gives you. Nothing is required; with no choice made the plain wording is used.
 */
export function LayoutSection() {
  const client = useQueryClient();
  const layout = useLayout();
  const sections = useSections();
  const template = useTemplate();
  const tags = useTags();
  const update = useUpdateSettings();
  const [message, setMessage] = useState<string | null>(null);

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
      <fieldset className="border-0 p-0">
        <legend className="mb-1 font-semibold">Game</legend>
        <p className="mb-2 text-sm text-ink-muted">
          A game changes wording and adds quick actions. It never adds any facts about the game.
        </p>
        <div className="flex flex-col gap-2">
          {TEMPLATES.map((t) => (
            <div key={t.id}>
              <label className="tap flex items-center gap-3 font-semibold">
                <input
                  type="radio"
                  name="template"
                  value={t.id}
                  checked={template.id === t.id}
                  aria-describedby={`template-${t.id}-about`}
                  onChange={() => {
                    // Names you typed belong to the old wording, so they are cleared; order and
                    // what you hid are kept.
                    save({ ...layout, template: t.id, labels: {} });
                  }}
                  className="size-4 accent-accent"
                />
                {t.name}
              </label>
              <p id={`template-${t.id}-about`} className="m-0 pl-7 text-sm text-ink-muted">
                {t.about}
              </p>
            </div>
          ))}
        </div>
      </fieldset>

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
          Reset sections to the game&apos;s defaults
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
