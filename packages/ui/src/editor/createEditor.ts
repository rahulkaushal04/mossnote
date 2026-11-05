import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { editorExtensions, LARGE_DOC_CHARS } from './extensions';

export interface EditorOptions {
  doc: string;
  onChange?: (text: string) => void;
  /** Cheap alternative to onChange: no text is copied. Prefer it on large documents; read getText() when needed. */
  onDirty?: () => void;
  /** Replaces the default editorExtensions() (markdown, live preview, formatting keys; plain text above LARGE_DOC_CHARS). */
  extensions?: Extension[];
  /** A trashed note opens read-only. Programmatic edits must also respect state.readOnly. */
  readOnly?: boolean;
}

export interface EditorHandle {
  readonly view: EditorView;
  getText(): string;
  setText(text: string): void;
  setReadOnly(readOnly: boolean): void;
  destroy(): void;
}

/**
 * Lossless line-ending strategy: CodeMirror splits on \r\n, \r and \n by default and
 * rejoins with \n, which silently rewrites CRLF/CR files. Instead we pin the separator:
 * "\r\n" only when every line break is CRLF, otherwise "\n" (a stray \r then stays as a
 * character inside its line, so mixed files round-trip byte for byte).
 * shortcut: in mixed files a \r is a visible/zero-width char in the line, revisit in T12.
 */
export function pickLineSeparator(text: string): '\r\n' | '\n' {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length;
  return crlf > 0 && crlf === lf && !/\r(?!\n)/.test(text) ? '\r\n' : '\n';
}

export function createEditor(parent: HTMLElement, opts: EditorOptions): EditorHandle {
  const sep = new Compartment();
  const ro = new Compartment();
  let readOnly = opts.readOnly ?? false;
  const roExt = (v: boolean) => [EditorState.readOnly.of(v), EditorView.editable.of(!v)];
  const makeState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        sep.of(EditorState.lineSeparator.of(pickLineSeparator(doc))),
        ro.of(roExt(readOnly)),
        history({ minDepth: 200 }),
        // Dropping a doc change on a read-only state also stops widgets and programmatic dispatches.
        EditorState.transactionFilter.of((tr) =>
          tr.docChanged && tr.startState.readOnly ? [] : tr,
        ),
        ...(opts.extensions ?? editorExtensions({ large: doc.length > LARGE_DOC_CHARS })),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.contentAttributes.of({ 'aria-label': 'Note editor' }),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          opts.onDirty?.();
          if (opts.onChange) opts.onChange(u.state.sliceDoc());
        }),
      ],
    });
  const view = new EditorView({ state: makeState(opts.doc), parent });
  return {
    view,
    // sliceDoc joins with the configured separator; doc.toString() would always use "\n".
    getText: () => view.state.sliceDoc(),
    // setState (not a dispatch) so the separator is re-chosen and undo history resets.
    setText: (text: string) => view.setState(makeState(text)),
    setReadOnly: (v: boolean) => {
      readOnly = v;
      view.dispatch({ effects: ro.reconfigure(roExt(v)) });
    },
    destroy: () => view.destroy(),
  };
}
