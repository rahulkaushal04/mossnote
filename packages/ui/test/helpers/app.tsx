import { act } from 'react';
import axe from 'axe-core';
import type { RpcResult } from '@mossnote/core/rpc';
import { App } from '../../src/app/App';
import type { AppModel } from '../../src/app/model';
import type { EditorFactory } from '../../src/editor/EditorPane';
import { applyTheme, type ThemeMode } from '../../src/theme/applyTheme';
import { fakeEditorFactory, mount, waitFor, type Mounted } from './dom';
import { manualTimers } from './timers';
import type { Env } from './workspace';

export const fail = (message: string): RpcResult<never> => ({
  ok: false,
  error: { code: 'internal', message },
});

export const noteOptions = () => [
  ...document.querySelectorAll<HTMLElement>('ul[aria-label="Notes"] [role=option]'),
];
export const treeItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role=treeitem]')].find((e) =>
    e.textContent?.includes(label),
  );
export const text = () => document.body.textContent ?? '';

export interface Booted {
  m: Mounted;
  timers: ReturnType<typeof manualTimers>;
  model(): AppModel;
  fake: ReturnType<typeof fakeEditorFactory>;
}

/**
 * Mounts the real App on a real workspace. `ready` says what "booted" means for this scenario
 * (default: the list shows notes or the empty message). Manual timers: nothing fires on its own.
 */
export async function bootApp(
  env: Env,
  o: {
    theme?: ThemeMode;
    editor?: 'real' | 'fake' | EditorFactory;
    ready?: () => boolean;
  } = {},
): Promise<Booted> {
  const timers = manualTimers();
  const fake = fakeEditorFactory();
  if (o.theme) await env.bridge.rpc('prefs.set', { theme: o.theme });
  let model: AppModel | undefined;
  const factory =
    o.editor === 'real' ? undefined : typeof o.editor === 'function' ? o.editor : fake.factory;
  const m = await mount(
    <App
      bridge={env.bridge}
      timers={timers}
      {...(factory ? { createEditor: factory } : {})}
      onReady={(x) => (model = x)}
    />,
  );
  await waitFor(o.ready ?? (() => noteOptions().length > 0 || /No notes yet/.test(text())), 'boot');
  return { m, timers, fake, model: () => model! };
}

export async function seed(env: Env, ...bodies: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const body of bodies) {
    const r = await env.bridge.rpc('notes.create', { body });
    if (!r.ok) throw new Error('seed failed');
    ids.push((r.value as { id: string }).id);
  }
  return ids;
}

export async function typeInto(el: HTMLInputElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function setTheme(mode: 'light' | 'dark') {
  applyTheme(mode);
}

export interface Violation {
  id: string;
  impact: string | null | undefined;
  nodes: string[];
}
/**
 * axe over the whole document. color-contrast is off: jsdom has no layout or computed colors, so
 * contrast is proven by the token pair test (contrast.test.ts), not here. Needs REAL timers.
 */
export async function runAxe(): Promise<Violation[]> {
  const r = await axe.run(document, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  return r.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.html.slice(0, 120)),
  }));
}
export const serious = (v: Violation[]) =>
  v.filter((x) => x.impact === 'serious' || x.impact === 'critical');
