import { isolateHistory } from '@codemirror/commands';
import { EditorView, WidgetType } from '@codemirror/view';

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s?)/;

/** Replace exactly one character inside `[ ]`. Does nothing in a read-only editor (dispatch ignores readOnly). */
export function toggleTaskAt(view: EditorView, markerFrom: number): boolean {
  if (view.state.readOnly) return false;
  const marker = view.state.sliceDoc(markerFrom, markerFrom + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return false;
  view.dispatch({
    changes: { from: markerFrom + 1, to: markerFrom + 2, insert: marker[1] === ' ' ? 'x' : ' ' },
    annotations: isolateHistory.of('full'),
    userEvent: 'input.toggle',
  });
  return true;
}

/**
 * Mod-Shift-Enter and the toolbar button. On a task line it toggles the box (one character). On any
 * other line it makes a task: a bullet gets `[ ] ` after its marker, a plain line gets `- [ ] `.
 * Consumes the key even when read-only, but never edits then (dispatch ignores readOnly).
 */
export function toggleTaskCommand(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const m = TASK.exec(line.text);
  if (m) {
    if (!view.state.readOnly) toggleTaskAt(view, line.from + m[1]!.length - 1);
    return true;
  }
  if (view.state.readOnly) return true;
  const bullet = /^(\s*[-*+]\s+)/.exec(line.text);
  const indent = /^\s*/.exec(line.text)![0];
  view.dispatch({
    changes: bullet
      ? { from: line.from + bullet[1]!.length, insert: '[ ] ' }
      : { from: line.from + indent.length, insert: '- [ ] ' },
    annotations: isolateHistory.of('full'),
    userEvent: 'input',
  });
  return true;
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-task-box';
    el.setAttribute('role', 'checkbox');
    el.setAttribute('aria-checked', String(this.checked));
    el.setAttribute('aria-label', 'Task');
    el.tabIndex = -1; // not a tab stop: the keyboard path is Mod-Shift-Enter
    el.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor selection
    el.addEventListener('click', (e) => {
      e.preventDefault();
      toggleTaskAt(view, view.posAtDOM(el));
    });
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}
