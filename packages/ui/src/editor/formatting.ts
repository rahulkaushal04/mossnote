import { EditorSelection, Prec, type ChangeSpec, type EditorState } from '@codemirror/state';
import { keymap, type EditorView, type KeyBinding } from '@codemirror/view';
import { commands as manifest } from '../commands/manifest';
import { toggleTaskCommand } from './checklist';

type Cmd = (view: EditorView) => boolean;

/** Commands that CodeMirror's default keymap also binds and that we intentionally take over. */
export const EDITOR_KEY_OVERRIDES: readonly string[] = ['Mod-i']; // replaces selectParentSyntax

/** Wrap each non-empty line piece of every range (so blank lines never end up inside the markers). */
function wrap(mark: string, notAfter?: string): Cmd {
  return (view) => {
    const { state } = view;
    if (state.readOnly) return true;
    const n = mark.length;
    view.dispatch(
      state.changeByRange((r) => {
        if (r.empty) {
          return { changes: { from: r.from, insert: mark + mark }, range: selAt(r.from + n) };
        }
        const pieces: { from: number; to: number }[] = [];
        for (let l = state.doc.lineAt(r.from); ; l = state.doc.line(l.number + 1)) {
          const from = Math.max(l.from, r.from);
          const to = Math.min(l.to, r.to);
          if (from < to) pieces.push({ from, to });
          if (l.to >= r.to) break;
        }
        if (!pieces.length) return { range: r };
        const first = pieces[0]!;
        const last = pieces[pieces.length - 1]!;
        if (
          pieces.length === 1 &&
          state.sliceDoc(first.from - n, first.from) === mark &&
          state.sliceDoc(first.to, first.to + n) === mark &&
          !(notAfter && state.sliceDoc(first.from - n - 1, first.from - n) === notAfter)
        ) {
          return {
            changes: [
              { from: first.from - n, to: first.from },
              { from: first.to, to: first.to + n },
            ],
            range: selRange(r, first.from - n, first.to - n),
          };
        }
        const changes: ChangeSpec[] = pieces.flatMap((p) => [
          { from: p.from, insert: mark },
          { from: p.to, insert: mark },
        ]);
        return {
          changes,
          range: selRange(r, first.from + n, last.to + n * (2 * pieces.length - 1)),
        };
      }),
      { userEvent: 'input.format', scrollIntoView: true },
    );
    return true;
  };
}

const selAt = (p: number) => EditorSelection.cursor(p);
const selRange = (r: { anchor: number; head: number }, a: number, b: number) =>
  r.anchor <= r.head ? EditorSelection.range(a, b) : EditorSelection.range(b, a);

/** `[sel](url)` with `url` selected; with no selection `[](url)` and the cursor inside the brackets. */
const link: Cmd = (view) => {
  const { state } = view;
  if (state.readOnly) return true;
  view.dispatch(
    state.changeByRange((r) => {
      const tail = '](url)';
      return {
        changes: [
          { from: r.from, insert: '[' },
          { from: r.to, insert: tail },
        ],
        range: r.empty
          ? EditorSelection.cursor(r.from + 1)
          : EditorSelection.range(r.to + 1 + 2, r.to + 1 + 5),
      };
    }),
    { userEvent: 'input.format', scrollIntoView: true },
  );
  return true;
};

function linesOf(state: EditorState): { from: number; text: string }[] {
  const seen = new Set<number>();
  const out: { from: number; text: string }[] = [];
  for (const r of state.selection.ranges) {
    for (let l = state.doc.lineAt(r.from); ; l = state.doc.line(l.number + 1)) {
      if (!seen.has(l.from)) {
        seen.add(l.from);
        out.push({ from: l.from, text: l.text });
      }
      if (l.to >= r.to) break;
    }
  }
  return out;
}

const BULLET = /^(\s*)[-*+] /;
/** Toggle "- " on the selected lines: remove when every non-blank line is a bullet, else add. */
const bullet: Cmd = (view) => {
  const { state } = view;
  if (state.readOnly) return true;
  const lines = linesOf(state).filter(
    (l) => l.text.trim() !== '' || state.selection.ranges.every((r) => r.empty),
  );
  const allBullets = lines.every((l) => BULLET.test(l.text));
  const changes: ChangeSpec[] = lines.flatMap((l): ChangeSpec[] => {
    const m = BULLET.exec(l.text);
    if (allBullets) return [{ from: l.from + m![1]!.length, to: l.from + m![0].length }];
    return m ? [] : [{ from: l.from + /^\s*/.exec(l.text)![0].length, insert: '- ' }];
  });
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
  return true;
};

const HEADING = /^(#{1,6})( +|$)/;
/** Cycle none -> # -> ## -> ### -> none, from the level of the first selected line. */
const heading: Cmd = (view) => {
  const { state } = view;
  if (state.readOnly) return true;
  const lines = linesOf(state);
  const level = HEADING.exec(lines[0]!.text)?.[1]!.length ?? 0;
  const next = level >= 3 ? 0 : level + 1;
  const changes: ChangeSpec[] = lines.map((l) => {
    const m = HEADING.exec(l.text);
    return {
      from: l.from,
      to: l.from + (m ? m[0].length : 0),
      insert: next ? '#'.repeat(next) + ' ' : '',
    };
  });
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
  return true;
};

export const formattingCommands = {
  'format.bold': wrap('**'),
  'format.italic': wrap('*', '*'),
  'format.link': link,
  'format.bullet': bullet,
  'format.heading': heading,
  'format.task': toggleTaskCommand,
} as const satisfies Record<string, Cmd>;

export type FormatBindings = Readonly<Record<string, string | undefined>>;

export const defaultFormatBindings: FormatBindings = Object.fromEntries(
  manifest.map((c) => [c.id, c.shortcut]),
);

/** High-precedence keymap; `bindings` maps command id (format.bold, ...) to a CodeMirror key. */
export function formattingKeymap(bindings: FormatBindings = defaultFormatBindings) {
  const keys: KeyBinding[] = [];
  for (const [id, run] of Object.entries(formattingCommands)) {
    const key = bindings[id];
    if (key) keys.push({ key, run, preventDefault: true });
  }
  return Prec.high(keymap.of(keys));
}
