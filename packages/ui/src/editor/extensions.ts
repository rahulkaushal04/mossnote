import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { formattingKeymap, type FormatBindings } from './formatting';
import { livePreview } from './livePreview';
import './editor.css';

export { EDITOR_KEY_OVERRIDES, formattingKeymap } from './formatting';
export const TAB_ESCAPE_HINT = 'Press Escape then Tab to leave the editor';

let hintCounter = 0;
/** Visually hidden description of the editor, referenced by aria-describedby. */
function tabHint(): Extension {
  const id = `mn-editor-hint-${++hintCounter}`;
  return [
    EditorView.contentAttributes.of({ 'aria-describedby': id }),
    ViewPlugin.define((view) => {
      const el = document.createElement('span');
      el.id = id;
      el.className = 'cm-sr-only';
      el.textContent = TAB_ESCAPE_HINT;
      view.dom.append(el);
      return { destroy: () => el.remove() };
    }),
  ];
}

// Every built-in CodeMirror color is routed through the S5 design tokens (no untested color left).
const theme = EditorView.theme({
  '&': { color: 'var(--fg)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: '2px solid var(--focus)' },
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--selection)' },
  '.cm-placeholder': { color: 'var(--fg-muted)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--code-bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
  },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--fg-muted)', border: 'none' },
});

/**
 * Above this many characters Markdown parsing and live preview are off: lezer-markdown is
 * super-linear on one huge paragraph (a 3 MB paragraph took ~9 s to mount). The text is untouched.
 */
export const LARGE_DOC_CHARS = 1_000_000;
export const LARGE_NOTE_HINT = 'Large note: formatting is off';

function largeNoteNotice(): Extension {
  return ViewPlugin.define((view) => {
    const el = document.createElement('div');
    el.className = 'cm-large-note';
    el.setAttribute('role', 'status');
    el.textContent = LARGE_NOTE_HINT;
    view.dom.prepend(el);
    return { destroy: () => el.remove() };
  });
}

export interface EditorExtensionOptions {
  /** Plain text with a visible notice: no Markdown parser, no live preview. */
  large?: boolean;
  /** Command id (format.bold, ...) to CodeMirror key; defaults to the shared manifest. */
  bindings?: FormatBindings;
}

export function editorExtensions(opts: EditorExtensionOptions = {}): Extension[] {
  if (opts.large)
    return [
      formattingKeymap(opts.bindings),
      largeNoteNotice(),
      tabHint(),
      theme,
      EditorView.lineWrapping,
    ];
  return [
    formattingKeymap(opts.bindings),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(classHighlighter),
    livePreview,
    tabHint(),
    theme,
    EditorView.lineWrapping,
  ];
}
