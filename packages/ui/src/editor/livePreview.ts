import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { CheckboxWidget } from './checklist';
import { ImageWidget, urlKey } from './images';

const line = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string) => Decoration.mark({ class: cls });
const hide = Decoration.replace({});

const MARKS: Record<string, string> = {
  ATXHeading1: 'cm-lp-h1',
  ATXHeading2: 'cm-lp-h2',
  ATXHeading3: 'cm-lp-h3',
  ATXHeading4: 'cm-lp-h4',
  ATXHeading5: 'cm-lp-h5',
  ATXHeading6: 'cm-lp-h6',
  SetextHeading1: 'cm-lp-h1',
  SetextHeading2: 'cm-lp-h2',
  Emphasis: 'cm-lp-em',
  StrongEmphasis: 'cm-lp-strong',
  Strikethrough: 'cm-lp-strike',
  InlineCode: 'cm-lp-code',
  Link: 'cm-lp-link',
  URL: 'cm-lp-url',
  ListMark: 'cm-lp-listmark',
};
const HIDDEN = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark']);

/** Pure: the decorations for the visible ranges. Never touches the document. */
export function buildDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  const sel = state.selection.ranges;
  const touched = (pos: number) => {
    const l = doc.lineAt(pos);
    return sel.some((r) => r.from <= l.to && r.to >= l.from);
  };
  const lines = (from: number, to: number, vr: { from: number; to: number }, cls: string) => {
    from = Math.max(from, vr.from);
    to = Math.min(to, vr.to);
    for (let l = doc.lineAt(from); ; l = doc.line(l.number + 1)) {
      out.push(line(cls).range(l.from));
      if (l.to >= to) break;
    }
  };
  const tree = syntaxTree(state);
  for (const vr of ranges) {
    tree.iterate({
      from: vr.from,
      to: vr.to,
      enter: (n) => {
        const name = n.name;
        if (n.from === n.to && name !== 'Image') return;
        const cls = MARKS[name];
        if (cls) out.push(mark(cls).range(n.from, n.to));
        if (HIDDEN.has(name)) {
          const parent = n.node.parent?.name ?? '';
          const hideable =
            name === 'CodeMark'
              ? parent === 'InlineCode'
              : name !== 'HeaderMark' || parent.startsWith('ATX');
          if (hideable && !touched(n.from)) {
            const next = name === 'HeaderMark' && doc.sliceString(n.to, n.to + 1) === ' ' ? 1 : 0;
            out.push(hide.range(n.from, n.to + next));
          }
        } else if (name === 'FencedCode') {
          lines(n.from, n.to, vr, 'cm-lp-fence');
        } else if (name === 'Blockquote') {
          lines(n.from, n.to, vr, 'cm-lp-quote');
        } else if (name === 'TableHeader') {
          out.push(line('cm-lp-table-header').range(doc.lineAt(n.from).from));
        } else if (name === 'TableRow') {
          out.push(line('cm-lp-table-row').range(doc.lineAt(n.from).from));
        } else if (name === 'TableDelimiter' && n.node.parent?.name === 'Table') {
          out.push(line('cm-lp-table-delim').range(doc.lineAt(n.from).from));
        } else if (name === 'TaskMarker') {
          const checked = doc.sliceString(n.from + 1, n.from + 2) !== ' ';
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(n.from, n.to));
        } else if (name === 'Image') {
          out.push(imageWidget(state, n.node));
        }
      },
    });
  }
  return Decoration.set(out, true);
}

function imageWidget(
  state: EditorState,
  node: { from: number; to: number; getChild(n: string): { from: number; to: number } | null },
) {
  const url = node.getChild('URL');
  const alt =
    /^!\[([^\]\n]{0,200})/.exec(
      state.sliceDoc(node.from, Math.min(node.to, node.from + 204)),
    )?.[1] ?? '';
  const from = url?.from ?? 0;
  const to = url?.to ?? 0;
  const key = urlKey(
    to - from,
    state.sliceDoc(from, Math.min(to, from + 4096)),
    state.sliceDoc(Math.max(from, to - 128), to),
  );
  const w = new ImageWidget(alt, from, to, key);
  return Decoration.widget({ widget: w, side: 1 }).range(node.to);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state, view.visibleRanges);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.state) !== syntaxTree(u.startState)
      )
        this.decorations = buildDecorations(u.state, u.view.visibleRanges);
    }
  },
  { decorations: (v) => v.decorations },
);
