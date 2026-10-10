import { REQUEST_TEMPLATE_URL } from '@shared/links';
import { TEMPLATES, type GameTemplate } from '@shared/templates';
import { CheckIcon, FarmIcon, JournalIcon } from '../../components/ui/icons';

const CALENDAR_NOTE: Record<GameTemplate['calendar'], string> = {
  counter: 'Counts the days',
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
      <p id={`${name}-hint`} className="mb-3 text-sm text-ink-muted">
        A template sets the wording and the sections. Default works for any game.
      </p>
      <div className="flex flex-col gap-3">
        {TEMPLATES.map((template) => {
          const Icon = template.order.includes('farm') ? FarmIcon : JournalIcon;
          return (
            <label
              key={template.id}
              // The card wears its own tint, so choosing a game previews the journal's colour.
              data-tint={template.tint}
              className="template-card tap relative grid cursor-pointer grid-cols-[2.5rem_1fr_1.5rem] items-start gap-x-3 rounded-lg border border-hairline bg-raised p-4"
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
                className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
              />
              <span
                aria-hidden="true"
                className="row-span-3 grid size-10 place-items-center rounded-md bg-accent-soft text-xl text-accent"
              >
                <Icon />
              </span>
              <span className="font-serif text-lg font-medium">{template.name}</span>
              <span
                aria-hidden="true"
                className="template-check col-start-3 row-start-1 grid size-6 place-items-center rounded-full border border-control text-accent-ink"
              >
                <CheckIcon className="size-4" />
              </span>
              <span id={`${name}-${template.id}-about`} className="col-start-2 text-sm text-ink-2">
                {template.about}
              </span>
              <span className="col-start-2 text-sm text-ink-muted">{contents(template)}</span>
            </label>
          );
        })}
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
