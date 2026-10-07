import { REQUEST_TEMPLATE_URL } from '@shared/links';
import { TEMPLATES, type GameTemplate } from '@shared/templates';

const CALENDAR_NOTE: Record<GameTemplate['calendar'], string> = {
  counter: 'Counts days',
  seasons: 'Seasons and years',
};

/** What a template gives you, in one line, built from the template itself. */
const contents = (template: GameTemplate): string =>
  `${template.order.map((id) => template.terms[id].label).join(', ')} · ${CALENDAR_NOTE[template.calendar]}`;

/**
 * The "Which template?" question: one radio group, Default first and chosen, with a line about
 * what each template contains and a pointer for asking for another. Arrow keys move between
 * choices and Tab leaves the group, as for any radio group.
 */
export function TemplatePicker({
  value,
  onChange,
  name,
  legend = 'Which template?',
}: {
  value: string;
  onChange: (id: string) => void;
  name: string;
  legend?: string;
}) {
  return (
    <fieldset className="m-0 border-0 p-0" aria-describedby={`${name}-hint`}>
      <legend className="mb-1 font-semibold">{legend}</legend>
      <p id={`${name}-hint`} className="mb-2 text-sm text-ink-muted">
        A template sets the wording and the sections. Default fits any game.
      </p>
      <div className="flex flex-col gap-2">
        {TEMPLATES.map((template) => (
          <label
            key={template.id}
            className="tap grid cursor-pointer grid-cols-[1rem_1fr] gap-x-3 rounded-panel border border-rule p-3 has-[:checked]:border-accent has-[:checked]:bg-surface"
          >
            <input
              type="radio"
              name={name}
              value={template.id}
              checked={value === template.id}
              aria-describedby={`${name}-${template.id}-about`}
              onChange={() => {
                onChange(template.id);
              }}
              className="mt-1 size-4 accent-accent"
            />
            <span className="font-semibold">{template.name}</span>
            <span
              id={`${name}-${template.id}-about`}
              className="col-start-2 text-sm text-ink-muted"
            >
              {template.about}
            </span>
            <span className="col-start-2 text-sm text-ink-muted">{contents(template)}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        Don&apos;t see your game?{' '}
        <a href={REQUEST_TEMPLATE_URL} target="_blank" rel="noreferrer noopener">
          Request a template
        </a>{' '}
        (opens the project&apos;s feature request form in your browser).
      </p>
    </fieldset>
  );
}
