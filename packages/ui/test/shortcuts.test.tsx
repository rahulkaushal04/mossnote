// @vitest-environment jsdom
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { markdownKeymap } from '@codemirror/lang-markdown';
import type { KeyBinding } from '@codemirror/view';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMenuTemplate } from '../../desktop/src/menu';
import { commands as manifest, type CommandSpec } from '../src/commands/manifest';
import { createRegistry } from '../src/commands/registry';
import { EDITOR_KEY_OVERRIDES } from '../src/editor/extensions';
import { ShortcutsView, FIXED_KEYS } from '../src/shortcuts/ShortcutsView';
import { formatShortcut, matchesEvent, normalizeKey, type Platform } from '../src/shortcuts/keys';
import { mount, press, type Mounted } from './helpers/dom';

type Os = 'mac' | 'win' | 'linux';
const platformOf = (os: Os): Platform => (os === 'mac' ? 'mac' : 'other');
/** CodeMirror picks the platform field first, then `key`. */
const cmKey = (b: KeyBinding, os: Os) =>
  (os === 'mac' ? b.mac : os === 'win' ? b.win : b.linux) ?? b.key;
const CM_BINDINGS = [...defaultKeymap, ...historyKeymap, ...searchKeymap, ...markdownKeymap];
// Keys the OS or CodeMirror's tab-focus toggle already owns.
const RESERVED = ['Mod-m', 'Mod-h', 'Mod-q', 'Mod-w'];

/** Every manifest shortcut that collides with another manifest key, CodeMirror, or an OS key. */
function findClashes(specs: readonly CommandSpec[], os: Os, allow: readonly string[]): string[] {
  const p = platformOf(os);
  const foreign = new Map<string, string>();
  for (const b of CM_BINDINGS) {
    for (const k of [cmKey(b, os), b.shift && `Shift-${cmKey(b, os)}`]) {
      if (k) foreign.set(normalizeKey(k, p), 'codemirror');
    }
  }
  for (const k of RESERVED) foreign.set(normalizeKey(k, p), 'os');
  foreign.set(normalizeKey(os === 'mac' ? 'Shift-Alt-m' : 'Ctrl-m', p), 'codemirror tab-focus');
  const allowed = new Set(allow.map((k) => normalizeKey(k, p)));
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const s of specs) {
    if (!s.shortcut) continue;
    const k = normalizeKey(s.shortcut, p);
    if (seen.has(k)) out.push(`${os}: ${s.id} duplicates ${seen.get(k)} (${k})`);
    else if (foreign.has(k) && !allowed.has(k))
      out.push(`${os}: ${s.id} clashes with ${foreign.get(k)} (${k})`);
    seen.set(k, s.id);
  }
  return out;
}

describe('shortcut clashes', () => {
  for (const os of ['mac', 'win', 'linux'] as const) {
    it(`manifest has no clash on ${os} (override allowlist: ${EDITOR_KEY_OVERRIDES.join(',')})`, () => {
      expect(findClashes(manifest, os, EDITOR_KEY_OVERRIDES)).toEqual([]);
    });
  }
  it('the allowlist is needed and nothing else is silently allowed', () => {
    expect(findClashes(manifest, 'linux', [])).toEqual([
      'linux: format.italic clashes with codemirror (Ctrl-i)',
    ]);
  });
  it('fails on injected duplicates, CodeMirror clashes, search clashes and OS keys', () => {
    const bad = [
      ...manifest,
      { id: 'x.dup', title: 'dup', shortcut: 'mod-B' }, // same as format.bold, different spelling
      { id: 'x.cm', title: 'cm', shortcut: 'Mod-Backspace' },
      { id: 'x.search', title: 's', shortcut: 'Mod-Shift-l' },
      { id: 'x.os', title: 'os', shortcut: 'Mod-h' },
      { id: 'x.tab', title: 'tab', shortcut: 'Ctrl-m' },
    ];
    const out = findClashes(bad, 'linux', EDITOR_KEY_OVERRIDES).join('\n');
    expect(out).toMatch(/x\.dup duplicates format\.bold/);
    expect(out).toMatch(/x\.cm clashes with codemirror/);
    expect(out).toMatch(/x\.search clashes with codemirror/);
    expect(out).toMatch(/x\.os clashes with os/);
    expect(out).toMatch(/x\.tab clashes with codemirror tab-focus/);
  });
  it('manifest ids are unique and F1 / F2 are bound as documented', () => {
    expect(new Set(manifest.map((c) => c.id)).size).toBe(manifest.length);
    const by = Object.fromEntries(manifest.map((c) => [c.id, c.shortcut]));
    expect(by['view.shortcuts']).toBe('F1');
    expect(by['folder.rename']).toBe('F2');
    expect(by['view.palette']).toBe('Mod-k');
    expect(by).not.toHaveProperty('note.rename'); // the title comes from the first line
    for (const id of ['nav.all', 'nav.favorites', 'nav.trash', 'folder.new']) {
      expect(by).toHaveProperty(id);
    }
  });
});

describe('key matching', () => {
  const ev = (key: string, init: KeyboardEventInit = {}) =>
    new KeyboardEvent('keydown', { key, ...init });
  it('normalizes and formats per platform', () => {
    expect(normalizeKey('Shift-Mod-K', 'mac')).toBe('Shift-Meta-k');
    expect(normalizeKey('Mod-Alt-1', 'other')).toBe('Ctrl-Alt-1');
    expect(formatShortcut('Mod-Shift-l', 'mac')).toBe('⇧⌘L');
    expect(formatShortcut('Mod-Shift-l', 'other')).toBe('Ctrl+Shift+L');
  });
  it('matches exact modifiers only, and falls back to code for shifted symbols', () => {
    expect(matchesEvent(ev('k', { ctrlKey: true }), 'Mod-k', 'other')).toBe(true);
    expect(matchesEvent(ev('k', { ctrlKey: true, shiftKey: true }), 'Mod-k', 'other')).toBe(false);
    expect(matchesEvent(ev('k', { metaKey: true }), 'Mod-k', 'other')).toBe(false);
    expect(
      matchesEvent(
        ev('*', { metaKey: true, shiftKey: true, code: 'Digit8' }),
        'Mod-Shift-8',
        'mac',
      ),
    ).toBe(true);
    expect(matchesEvent(ev('F1'), 'F1', 'mac')).toBe(true);
  });
});

describe('menu and registry', () => {
  const menuIds = (os: string) => {
    const clicked: string[] = [];
    const reg = createRegistry();
    for (const c of manifest) reg.bind(c.id, () => clicked.push(c.id));
    const tpl = buildMenuTemplate(manifest, {
      platform: os,
      appName: 'Mossnote',
      send: (id) => reg.run(id),
    });
    const items: { id?: string; click?: () => void }[] = [];
    const walk = (t: readonly { id?: string; click?: unknown; submenu?: unknown }[]) => {
      for (const i of t) {
        if (i.id) items.push(i as never);
        if (Array.isArray(i.submenu)) walk(i.submenu);
      }
    };
    walk(tpl as never);
    return { items, clicked };
  };
  it('every desktop menu id is in the manifest and every menu command is in the menu', () => {
    for (const os of ['darwin', 'linux']) {
      const { items } = menuIds(os);
      const ids = new Set(manifest.map((c) => c.id));
      expect(items.filter((i) => !ids.has(i.id!)).map((i) => i.id)).toEqual([]);
      expect(
        manifest.filter((c) => c.menu && !items.some((i) => i.id === c.id)).map((c) => c.id),
      ).toEqual([]);
    }
  });
  it('clicking each menu item runs the registry entry exactly once', () => {
    const { items, clicked } = menuIds('linux');
    for (const i of items) i.click!();
    expect(clicked.sort()).toEqual(
      manifest
        .filter((c) => c.menu)
        .map((c) => c.id)
        .sort(),
    );
  });
  it('list() hides disabled and unbound commands; run() refuses them; bind rejects unknown ids', () => {
    const reg = createRegistry();
    let on = false;
    let ran = 0;
    reg.bind('note.new', () => ran++, { enabled: () => on });
    expect(reg.list()).toEqual([]);
    expect(reg.run('note.new')).toBe(false);
    on = true;
    expect(reg.list().map((c) => c.id)).toEqual(['note.new']);
    expect(reg.run('note.new')).toBe(true);
    expect(ran).toBe(1);
    expect(reg.run('format.bold')).toBe(false);
    expect(() => reg.bind('nope', () => {})).toThrow(/unknown/);
  });
});

describe('ShortcutsView', () => {
  let m: Mounted | undefined;
  afterEach(async () => {
    await m?.unmount();
    m = undefined;
  });
  it('lists every manifest shortcut and the fixed CodeMirror keys, closes on F1, and passes axe', async () => {
    let closed = 0;
    m = await mount(<ShortcutsView platform="other" onClose={() => closed++} />);
    const text = document.querySelector('[role=dialog]')!.textContent!;
    for (const c of manifest.filter((x) => x.shortcut)) {
      expect(text).toContain(c.title);
      expect(text).toContain(formatShortcut(c.shortcut!, 'other'));
    }
    for (const k of FIXED_KEYS) expect(text).toContain(k.title);
    expect(text).toContain('Escape then Tab');
    const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await press(document.activeElement!, 'F1');
    expect(closed).toBe(1);
    await press(document.activeElement!, 'Escape');
    expect(closed).toBe(2);
  });
});
