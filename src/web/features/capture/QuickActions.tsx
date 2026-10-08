import type { QuickAction } from '@shared/templates';
import { Chip } from '../../components/ui/Chip';
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
    // One scrolling row on a phone, so the composer stays near the top; wraps from 640px up.
    <div
      role="group"
      aria-label="Quick actions"
      className="scroll-row -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 phone:mx-0 phone:flex-wrap phone:overflow-visible phone:px-0"
    >
      {template.quickActions.map((action) => (
        <Chip
          key={action.id}
          selected={isOn(value, action)}
          className="shrink-0"
          onToggle={() => {
            onChange(toggle(value, action));
          }}
        >
          {action.label}
        </Chip>
      ))}
    </div>
  );
}
