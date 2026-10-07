import type { QuickAction } from '@shared/templates';
import { useLayout, useTemplate } from '../settings/useLayout';
import { withTag, type NoteDraft } from './draft';

const isOn = (draft: NoteDraft, action: QuickAction): boolean => {
  const { discovery, question, tag } = action.set;
  if (discovery) return draft.isDiscovery;
  if (question) return draft.isQuestion;
  return tag !== undefined && draft.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
};

function toggle(draft: NoteDraft, action: QuickAction): NoteDraft {
  const { discovery, question, tag } = action.set;
  if (discovery) return { ...draft, isDiscovery: !draft.isDiscovery };
  if (question) return { ...draft, isQuestion: !draft.isQuestion };
  if (tag === undefined) return draft;
  return isOn(draft, action)
    ? { ...draft, tags: draft.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) }
    : withTag(draft, tag);
}

/**
 * The game template's one-tap actions above the composer. Each only sets a flag or a tag on the
 * note being written, so capture stays one tap and one shortcut. Absent when the template has
 * none or the person turned them off in Settings.
 */
export function QuickActions({
  value,
  onChange,
}: {
  value: NoteDraft;
  onChange: (next: NoteDraft) => void;
}) {
  const template = useTemplate();
  const layout = useLayout();
  if (!layout.quickActions || template.quickActions.length === 0) return null;
  return (
    <div role="group" aria-label="Quick actions" className="mb-3 flex flex-wrap gap-2">
      {template.quickActions.map((action) => (
        <button
          key={action.id}
          type="button"
          aria-pressed={isOn(value, action)}
          className={`btn tap text-sm ${isOn(value, action) ? 'btn-primary' : ''}`}
          onClick={() => {
            onChange(toggle(value, action));
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
