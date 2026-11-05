// @vitest-environment jsdom
// AS-9: loading, empty and error states, each with a working recovery action, for the note list,
// editor, trash view, palette, tags and folder tree. Failures come from the loopback in front of
// the REAL dispatcher (inject = a failing reply, hold = a slow reply); recovery runs the real RPCs.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bootApp,
  fail,
  noteOptions,
  seed,
  text,
  treeItem,
  typeInto,
  type Booted,
} from './helpers/app';
import { byText, click, press, waitFor } from './helpers/dom';
import { makeEnv, type Env } from './helpers/workspace';

let env: Env | undefined;
let b: Booted | undefined;
afterEach(async () => {
  await b?.m.unmount();
  env?.cleanup();
  b = env = undefined;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

const shellUp = () => !!document.querySelector('nav') && !!document.querySelector('footer');
const boot = (o: Parameters<typeof bootApp>[1] = {}) => bootApp(env!, { ready: shellUp, ...o });
const has = (re: RegExp) => re.test(text());
const palette = () => document.querySelector<HTMLInputElement>('input[role=combobox]');
const openPalette = async () => {
  await press(document.body, 'k', { ctrlKey: true });
  await waitFor(() => !!palette(), 'palette');
};
const advance = (ms: number) => act(async () => void (await b!.timers.advance(ms)));
const alertWith = (re: RegExp) =>
  [...document.querySelectorAll('[role=alert]')].find((a) => re.test(a.textContent ?? ''));

describe('note list', () => {
  it('loading: shows "Loading notes…" only after 150 ms, then the notes', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    const hold = env.bridge.hold('notes.list');
    b = await boot();
    expect(has(/Loading notes/)).toBe(false); // no flash for a fast load
    await advance(200);
    await waitFor(() => has(/Loading notes…/), 'loading message');
    await act(async () => hold.release());
    await waitFor(() => noteOptions().length === 1, 'notes');
    expect(has(/Loading notes/)).toBe(false);
  });

  it('empty: says so and "New note" recovers', async () => {
    env = makeEnv();
    b = await boot({ ready: () => has(/No notes yet/) });
    await click(byText(document.body, 'New note'));
    await waitFor(() => noteOptions().length === 1, 'new note listed');
    expect(has(/No notes yet/)).toBe(false);
    expect(env.bridge.count('notes.create')).toBe(1);
  });

  it('error: shows the reason as an alert and Retry reloads', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    env.bridge.inject('notes.list', fail('disk unreadable'));
    b = await boot({ ready: () => has(/Couldn’t load notes/) });
    expect(alertWith(/Couldn’t load notes: disk unreadable/)).toBeTruthy();
    await click(byText(alertWith(/Couldn’t load notes/) as HTMLElement, 'Retry'));
    await waitFor(() => noteOptions().length === 1, 'notes after retry');
    expect(alertWith(/Couldn’t load notes/)).toBeUndefined();
  });
});

describe('editor', () => {
  it('empty: "Select or create a note", and New note opens an editor', async () => {
    env = makeEnv();
    b = await boot();
    expect(has(/Select or create a note/)).toBe(true);
    await click(byText(document.body, 'New note'));
    await waitFor(
      () => b!.fake.state.created >= 1 && !document.querySelector('.editor-host[hidden]'),
      'editor',
    );
    expect(has(/Select or create a note/)).toBe(false);
  });

  it('loading: "Loading note…" while notes.get is slow', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    b = await boot({ ready: () => noteOptions().length === 1 });
    const hold = env.bridge.hold('notes.get');
    await click(noteOptions()[0]);
    await waitFor(() => has(/Loading note…/), 'loading message');
    expect(document.querySelector('.editor-host')!.hasAttribute('hidden')).toBe(true);
    await act(async () => hold.release());
    await waitFor(() => !has(/Loading note…/), 'loaded');
    expect(document.querySelector('.editor-host')!.hasAttribute('hidden')).toBe(false);
  });

  it('error: the reason and a Retry that opens the note', async () => {
    env = makeEnv();
    await seed(env, 'Alpha body');
    b = await boot({ ready: () => noteOptions().length === 1 });
    env.bridge.inject('notes.get', fail('read failed'));
    await click(noteOptions()[0]);
    await waitFor(() => !!alertWith(/Couldn’t open note: read failed/), 'error');
    await click(byText(alertWith(/Couldn’t open note/) as HTMLElement, 'Retry'));
    await waitFor(() => b!.fake.state.text === 'Alpha body', 'note loaded after retry');
    expect(alertWith(/Couldn’t open note/)).toBeUndefined();
  });

  it('save error: the status says so, Retry saves, the status recovers', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    b = await boot({ ready: () => noteOptions().length === 1 });
    await click(noteOptions()[0]);
    await waitFor(() => b!.fake.state.text === 'Alpha', 'loaded');
    env.bridge.inject('notes.save', fail('disk full'));
    await act(async () => b!.fake.type('Alpha edited'));
    await advance(6000);
    await waitFor(() => has(/Not saved: disk full/), 'save error');
    const footer = document.querySelector('footer')!;
    await click(byText(footer as HTMLElement, 'Retry'));
    await waitFor(
      () => /Saved/.test(footer.textContent ?? '') && !/Not saved/.test(footer.textContent ?? ''),
      'saved again',
    );
    expect(env.bridge.count('notes.save')).toBeGreaterThanOrEqual(2);
  });
});

describe('trash view', () => {
  const goTrash = async () => {
    await click(treeItem('Trash'));
    await waitFor(() => !!document.querySelector('#trash-h'), 'trash view');
  };

  it('loading: "Loading Trash…" while trash.list is slow', async () => {
    env = makeEnv();
    b = await boot();
    const hold = env.bridge.hold('trash.list');
    await goTrash();
    await waitFor(() => has(/Loading Trash…/), 'loading');
    await act(async () => hold.release());
    await waitFor(() => has(/Trash is empty/), 'loaded');
  });

  it('empty: explains and "Back to all notes" returns to the list', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    b = await boot();
    await goTrash();
    await waitFor(() => has(/Trash is empty/), 'empty');
    await click(byText(document.body, 'Back to all notes'));
    await waitFor(() => b!.model().nav.get().kind === 'all' && noteOptions().length === 1, 'back');
  });

  it('error: the reason and Retry; a failed Restore says so and a second try works', async () => {
    env = makeEnv();
    const [id] = await seed(env, 'Gone');
    await env.bridge.rpc('notes.trash', { id });
    b = await boot();
    env.bridge.inject('trash.list', fail('trash unreadable'));
    await goTrash();
    await waitFor(() => !!alertWith(/Couldn’t load Trash: trash unreadable/), 'error');
    await click(byText(alertWith(/Couldn’t load Trash/) as HTMLElement, 'Retry'));
    await waitFor(() => !!byText(document.body, 'Restore'), 'rows after retry');
    env.bridge.inject('trash.restore', fail('locked'));
    await click(byText(document.body, 'Restore'));
    await waitFor(() => !!alertWith(/Couldn’t restore: locked/), 'restore error');
    expect(document.querySelector('[data-batch]')).not.toBeNull(); // still listed
    await click(byText(document.body, 'Restore'));
    await waitFor(() => has(/Trash is empty/), 'restored');
  });
});

describe('palette', () => {
  it('loading: commands are listed at once and "Loading notes…" shows until notes arrive', async () => {
    env = makeEnv();
    await seed(env, 'Alpha');
    b = await boot({ ready: () => noteOptions().length === 1 });
    const hold = env.bridge.hold('notes.list');
    await openPalette();
    expect(has(/Loading notes…/)).toBe(true);
    expect(document.querySelectorAll('[aria-label=Results] [role=option]').length).toBeGreaterThan(
      5,
    );
    await act(async () => hold.release());
    await waitFor(() => !has(/Loading notes…/), 'loaded');
  });

  it('empty: no matches says so and offers to create a note', async () => {
    env = makeEnv();
    b = await boot();
    await openPalette();
    // an empty workspace still lists commands, not a blank box
    expect(document.querySelectorAll('[aria-label=Results] [role=option]').length).toBeGreaterThan(
      5,
    );
    await typeInto(palette()!, 'zzqx');
    await waitFor(() => has(/No matches/), 'no matches');
    expect(has(/Create note “zzqx”/)).toBe(true);
    await press(palette()!, 'Enter');
    await waitFor(() => noteOptions().length === 1, 'created');
    expect(noteOptions()[0]!.textContent).toBe('zzqx');
    expect(palette()).toBeNull();
  });

  it('error: the reason and Retry loads the notes', async () => {
    env = makeEnv();
    await seed(env, 'Needle note');
    b = await boot({ ready: () => noteOptions().length === 1 });
    env.bridge.inject('notes.list', fail('index busy'));
    await openPalette();
    await waitFor(() => has(/Couldn’t load notes: index busy/), 'error');
    await click(byText(document.querySelector('.mn-pal-status') as HTMLElement, 'Retry'));
    await waitFor(() => !has(/Couldn’t load notes: index busy/), 'retry done');
    await typeInto(palette()!, 'Needle');
    await waitFor(() => has(/Needle note/), 'note found');
  });
});

describe('tags', () => {
  it('loading: "Loading tags…"', async () => {
    env = makeEnv();
    const hold = env.bridge.hold('tags.list');
    b = await boot();
    await waitFor(() => has(/Loading tags…/), 'loading');
    await act(async () => hold.release());
    await waitFor(() => has(/No tags yet/), 'loaded');
  });

  it('empty: says so and adding a tag lists it', async () => {
    env = makeEnv();
    b = await boot({ ready: () => has(/No tags yet/) });
    await typeInto(document.querySelector<HTMLInputElement>('label input')!, 'ideas');
    await click(byText(document.body, 'Add tag'));
    await waitFor(() => !has(/No tags yet/) && has(/ideas/), 'tag listed');
  });

  it('error: the reason and Retry', async () => {
    env = makeEnv();
    await env.bridge.rpc('tags.create', { name: 'ideas' });
    env.bridge.inject('tags.list', fail('tags unreadable'));
    b = await boot({ ready: () => has(/Couldn’t load tags/) });
    expect(alertWith(/Couldn’t load tags: tags unreadable/)).toBeTruthy();
    await click(byText(alertWith(/Couldn’t load tags/) as HTMLElement, 'Retry'));
    await waitFor(() => has(/ideas/) && !has(/Couldn’t load tags/), 'tags');
  });

  it('a failing create says why and keeps the typed name', async () => {
    env = makeEnv();
    b = await boot({ ready: () => has(/No tags yet/) });
    env.bridge.inject('tags.create', fail('name rejected'));
    const input = document.querySelector<HTMLInputElement>('label input')!;
    await typeInto(input, 'ideas');
    await click(byText(document.body, 'Add tag'));
    await waitFor(() => !!alertWith(/name rejected/), 'error');
    expect(input.value).toBe('ideas');
    await click(byText(document.body, 'Add tag'));
    await waitFor(() => has(/ideas/) && !alertWith(/name rejected/), 'created on retry');
  });
});

describe('folder tree', () => {
  it('loading: "Loading folders…" while folders.list is slow; the fixed entries stay usable', async () => {
    env = makeEnv();
    const hold = env.bridge.hold('folders.list');
    b = await boot();
    await waitFor(() => has(/Loading folders…/), 'loading');
    expect(treeItem('All notes')).toBeTruthy();
    await act(async () => hold.release());
    await waitFor(() => !has(/Loading folders…/), 'loaded');
  });

  it('empty: says there are no folders and "New folder" creates one for naming', async () => {
    env = makeEnv();
    b = await boot({ ready: () => has(/No folders yet/) });
    await click(byText(document.body, 'New folder'));
    await waitFor(() => !!document.querySelector('input[aria-label^="Rename folder"]'), 'naming');
    await press(document.querySelector('input[aria-label^="Rename folder"]')!, 'Enter');
    await waitFor(() => !has(/No folders yet/) && !!treeItem('New folder'), 'folder listed');
  });

  it('error: the reason and Retry', async () => {
    env = makeEnv();
    await env.bridge.rpc('folders.create', { name: 'Work' });
    env.bridge.inject('folders.list', fail('folders unreadable'));
    b = await boot({ ready: () => has(/Couldn’t load folders/) });
    expect(alertWith(/Couldn’t load folders: folders unreadable/)).toBeTruthy();
    await click(byText(alertWith(/Couldn’t load folders/) as HTMLElement, 'Retry'));
    await waitFor(() => !!treeItem('Work') && !has(/Couldn’t load folders/), 'folders');
  });
});
