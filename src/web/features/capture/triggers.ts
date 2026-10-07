export type TriggerKind = 'tag' | 'person' | 'link' | 'command';

export interface Trigger {
  kind: TriggerKind;
  /** Offset of the trigger character(s) in the text. */
  start: number;
  /** Offset just after the query (the caret). */
  end: number;
  query: string;
}

const MAX_PERSON_QUERY = 40;
const MAX_LINK_QUERY = 60;

/**
 * Find the trigger the caret is inside (spec section 5.1, trigger grammar), or null.
 * - `#` and `@` work at line start or after whitespace (so email addresses are untouched);
 *   a tag query has no spaces, a person query may have up to two (a name of up to three words).
 * - `[[` works anywhere and ends at `]` or the end of the line.
 * - `/` works at line start only and opens the command menu.
 * Whether to open a picker at all (typed characters only, never paste or IME) is the caller's call.
 */
export function detectTrigger(text: string, caret: number): Trigger | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const before = text.slice(lineStart, caret);

  const link = before.lastIndexOf('[[');
  if (link !== -1) {
    const query = before.slice(link + 2);
    if (!query.includes(']') && query.length <= MAX_LINK_QUERY) {
      return { kind: 'link', start: lineStart + link, end: caret, query };
    }
  }

  if (before.startsWith('/') && !/\s/.test(before)) {
    return { kind: 'command', start: lineStart, end: caret, query: before.slice(1) };
  }

  let best: Trigger | null = null;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch !== '#' && ch !== '@') continue;
    if (i > 0 && !/\s/.test(before[i - 1] ?? '')) continue;
    const query = before.slice(i + 1);
    if (ch === '#') {
      if (/\s|#/.test(query)) continue;
      best = { kind: 'tag', start: lineStart + i, end: caret, query };
    } else {
      const spaces = (query.match(/ /g) ?? []).length;
      if (query.length > MAX_PERSON_QUERY || spaces > 2 || /[\n#@]/.test(query)) continue;
      best = { kind: 'person', start: lineStart + i, end: caret, query };
    }
    break;
  }
  return best;
}

export interface Applied {
  text: string;
  caret: number;
}

/** Replace the trigger text (`#abc`, `[[x`, `/ti`) with `replacement` (often empty). */
export function applyTrigger(text: string, trigger: Trigger, replacement = ''): Applied {
  const next = text.slice(0, trigger.start) + replacement + text.slice(trigger.end);
  return { text: next, caret: trigger.start + replacement.length };
}

export interface Command {
  id: 'title' | 'date' | 'discovery' | 'question' | 'tag' | 'person' | 'link';
  label: string;
  /** What typing `/<name>` matches. */
  name: string;
}

/** The `/` command menu (spec section 5.1). */
export const COMMANDS: readonly Command[] = [
  { id: 'title', label: 'Title', name: 'title' },
  { id: 'date', label: 'Date', name: 'date' },
  { id: 'discovery', label: 'Discovery', name: 'discovery' },
  { id: 'question', label: 'Question', name: 'question' },
  { id: 'tag', label: 'Tag', name: 'tag' },
  { id: 'person', label: 'Person', name: 'person' },
  { id: 'link', label: 'Link', name: 'link' },
];

export const matchCommands = (query: string): Command[] =>
  COMMANDS.filter((c) => c.name.startsWith(query.toLowerCase()));
