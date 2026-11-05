// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { CaptureApp } from '../src/capture/CaptureApp';
import { fakeEditorFactory, mount, press, waitFor, type Mounted } from './helpers/dom';
import { manualTimers } from './helpers/timers';
import { makeEnv, type Env } from './helpers/workspace';

let env: Env | undefined;
const mounts: Mounted[] = [];
afterEach(async () => {
  for (const x of mounts.splice(0)) await x.unmount();
  env?.cleanup();
  env = undefined;
});

const area = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
async function typeText(v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area(), v);
    area().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const modEnter = () => press(area(), 'Enter', { ctrlKey: true });
const inboxNotes = async (e: Env) => {
  const f = await e.bridge.rpc('folders.list');
  const inbox = (f as { value: { id: string; name: string }[] }).value.filter(
    (x) => x.name === 'Inbox',
  );
  const n = await e.bridge.rpc('notes.list', {});
  return { inbox, notes: (n as { value: { title: string; folderId: string | null }[] }).value };
};

describe('quick capture window', () => {
  it('has a labeled textarea, saves to Inbox on Mod-Enter, shows the message, clears and is ready again', async () => {
    env = makeEnv();
    mounts.push(await mount(<CaptureApp bridge={env.bridge} onClose={() => {}} />));
    expect(area().labels?.[0]?.textContent).toBe('Quick note');
    await typeText('Buy milk\nand eggs');
    await modEnter();
    await waitFor(() => /Saved to Inbox/.test(document.body.textContent ?? ''), 'saved message');
    expect(area().value).toBe('');
    expect(document.querySelector('[role=status]')!.textContent).toBe('Saved to Inbox');
    const { inbox, notes } = await inboxNotes(env);
    expect(inbox).toHaveLength(1);
    expect(notes).toMatchObject([{ title: 'Buy milk', folderId: inbox[0]!.id }]);

    await typeText('second thought');
    await modEnter();
    await waitFor(() => env!.bridge.count('capture.save') === 2, 'second save');
    await waitFor(() => area().value === '', 'cleared');
    expect((await inboxNotes(env)).inbox).toHaveLength(1); // one Inbox, reused
  });

  it('an empty capture saves nothing; a failed save keeps the text and says so', async () => {
    env = makeEnv();
    mounts.push(await mount(<CaptureApp bridge={env.bridge} onClose={() => {}} />));
    await modEnter();
    expect(env.bridge.count('capture.save')).toBe(0);
    env.bridge.inject('capture.save', { ok: false, error: { code: 'io', message: 'disk full' } });
    await typeText('keep me');
    await modEnter();
    await waitFor(() => !!document.querySelector('[role=alert]'), 'error');
    expect(document.querySelector('[role=alert]')!.textContent).toContain('disk full');
    expect(area().value).toBe('keep me');
    expect(document.body.textContent).not.toContain('Saved to Inbox');
  });

  it('Esc closes the window', async () => {
    env = makeEnv();
    let closed = 0;
    mounts.push(await mount(<CaptureApp bridge={env.bridge} onClose={() => closed++} />));
    await press(area(), 'Escape');
    expect(closed).toBe(1);
  });

  it('applies the saved theme', async () => {
    env = makeEnv();
    await env.bridge.rpc('prefs.set', { theme: 'dark' });
    mounts.push(await mount(<CaptureApp bridge={env.bridge} onClose={() => {}} />));
    await waitFor(() => document.documentElement.dataset.theme === 'dark', 'dark theme');
    document.documentElement.removeAttribute('data-theme');
  });

  it('only ever calls capture.save, app.status and prefs.get', async () => {
    env = makeEnv();
    mounts.push(await mount(<CaptureApp bridge={env.bridge} onClose={() => {}} />));
    await typeText('one');
    await modEnter();
    await press(area(), 'Escape');
    await waitFor(() => env!.bridge.count('capture.save') === 1, 'saved');
    const used = new Set(env.bridge.calls.map((c) => c.method));
    expect([...used].sort()).toEqual(['app.status', 'capture.save', 'prefs.get']);
  });

  it('the main window list refreshes after a capture, through the changed event', async () => {
    env = makeEnv();
    mounts.push(
      await mount(
        <App
          bridge={env.bridge}
          timers={manualTimers()}
          createEditor={fakeEditorFactory().factory}
        />,
      ),
    );
    await waitFor(() => /No notes yet/.test(document.body.textContent ?? ''), 'empty list');
    mounts.push(await mount(<CaptureApp bridge={env.bridge} onClose={() => {}} />));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        document.querySelector('main.capture textarea')!,
        'From the capture window',
      );
      document
        .querySelector('main.capture textarea')!
        .dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(
      async () =>
        void (await press(document.querySelector('main.capture textarea')!, 'Enter', {
          ctrlKey: true,
        })),
    );
    await waitFor(
      () =>
        [...document.querySelectorAll('ul[aria-label="Notes"] [role=option]')].some(
          (o) => o.textContent === 'From the capture window',
        ),
      'captured note in the main list',
    );
  });
});

describe('quick capture on quit (flush handshake)', () => {
  const flush = (token: string) =>
    act(async () => env!.bridge.emit({ type: 'flushRequest', token }));

  it('saves the typed text to the Inbox first, then acknowledges the token', async () => {
    env = makeEnv();
    mounts.push(await mount(<CaptureApp bridge={env.bridge} onClose={() => {}} />));
    await typeText('typed right before quit');
    await flush('tok-9');
    await waitFor(() => env!.bridge.count('app.flushed') === 1, 'ack');
    const methods = env.bridge.calls.map((c) => c.method);
    expect(methods.indexOf('capture.save')).toBeGreaterThan(-1);
    expect(methods.indexOf('capture.save')).toBeLessThan(methods.indexOf('app.flushed'));
    expect(env.bridge.calls.find((c) => c.method === 'app.flushed')?.args).toEqual({
      token: 'tok-9',
    });
    const { notes } = await inboxNotes(env);
    expect(notes).toMatchObject([{ title: 'typed right before quit' }]);
  });

  it('an empty window only acknowledges; a failed save still acknowledges (no 2 s stall)', async () => {
    env = makeEnv();
    mounts.push(await mount(<CaptureApp bridge={env.bridge} onClose={() => {}} />));
    await flush('t1');
    await waitFor(() => env!.bridge.count('app.flushed') === 1, 'ack');
    expect(env.bridge.count('capture.save')).toBe(0);
    await typeText('x');
    env.bridge.inject('capture.save', { ok: false, error: { code: 'io', message: 'disk' } });
    await flush('t2');
    await waitFor(() => env!.bridge.count('app.flushed') === 2, 'second ack');
  });
});
