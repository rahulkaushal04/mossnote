import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import type { EditorHandle, EditorOptions } from '../../src/editor/createEditor';

// React 19 needs this flag for act() outside a testing library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout; CodeMirror's measure pass needs these.
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
Range.prototype.getClientRects ??= noRects as never;
Range.prototype.getBoundingClientRect ??= (() => new DOMRect()) as never;

export interface Mounted {
  root: Root;
  el: HTMLElement;
  unmount(): Promise<void>;
}
export async function mount(node: ReactNode): Promise<Mounted> {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(node));
  return {
    root,
    el,
    async unmount() {
      await act(async () => root.unmount());
      el.remove();
    },
  };
}

/** Lets promises and timers settle inside act. */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
export async function waitFor(cond: () => boolean, what = 'condition', ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await settle(5);
  }
}
export async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('click: element missing');
  await act(async () => (el as HTMLElement).click());
}
export async function press(el: Element, key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}
export const byText = (root: ParentNode, text: string, sel = 'button'): HTMLElement | undefined =>
  [...root.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.trim() === text);

/** A plain stand-in for CodeMirror: the EditorPane contract only needs these methods. */
export function fakeEditorFactory() {
  const state = {
    text: '',
    readOnly: false,
    onChange: undefined as (() => void) | undefined,
    created: 0,
  };
  const factory = (parent: HTMLElement, opts: EditorOptions): EditorHandle => {
    state.created++;
    state.onChange = () => {
      opts.onDirty?.();
      opts.onChange?.(state.text);
    };
    parent.append(document.createElement('textarea'));
    return {
      view: { focus() {} } as never,
      getText: () => state.text,
      // Like CodeMirror's setState: replacing the document is not a user change.
      setText: (t) => void (state.text = t),
      setReadOnly: (v) => void (state.readOnly = v),
      destroy() {},
    };
  };
  return {
    factory,
    state,
    /** Simulates the user typing: the document changes, then onChange fires. */
    type(text: string) {
      if (state.readOnly) return;
      state.text = text;
      state.onChange?.();
    },
  };
}
