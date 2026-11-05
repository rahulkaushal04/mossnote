import { commands } from '@mossnote/ui/commands';
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { buildMenuTemplate, toAccelerator } from './menu.ts';

function flat(t: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return t.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);
}
const sent: string[] = [];
const build = (platform = 'darwin') =>
  buildMenuTemplate(commands, { platform, appName: 'Mossnote', send: (id) => sent.push(id) });

describe('AS-6 desktop menu', () => {
  it('contains every manifest menu item exactly once and nothing else with an id', () => {
    for (const p of ['darwin', 'linux']) {
      const ids = flat(build(p)).flatMap((i) => (i.id ? [i.id] : []));
      expect(ids.sort()).toEqual(
        commands
          .filter((c) => c.menu)
          .map((c) => c.id)
          .sort(),
      );
    }
  });
  it('puts items in the menu the manifest names', () => {
    const t = build();
    for (const c of commands.filter((c) => c.menu)) {
      const m = t.find((x) => x.label === c.menu);
      expect(
        flat(m?.submenu as MenuItemConstructorOptions[]).some((i) => i.id === c.id),
        c.id,
      ).toBe(true);
    }
  });
  it('sends the command id on click', () => {
    const item = flat(build()).find((i) => i.id === 'note.new');
    (item?.click as () => void)();
    expect(sent).toEqual(['note.new']);
  });
  it('lists the portability commands under File and sends their ids (those the manifest has so far)', () => {
    const ids = ['portability.export', 'portability.import', 'portability.backup', 'portability.restore'];
    const file = flat(build().find((x) => x.label === 'File')?.submenu as MenuItemConstructorOptions[]);
    for (const id of ids.filter((i) => commands.some((c) => c.id === i))) {
      expect(commands.find((c) => c.id === id)?.menu, id).toBe('File');
      const item = file.find((i) => i.id === id);
      sent.length = 0;
      (item?.click as () => void)();
      expect(sent, id).toEqual([id]);
    }
  });
  it('does not register accelerators that the renderer keymap owns', () => {
    for (const i of flat(build()).filter((i) => i.id)) {
      const spec = commands.find((c) => c.id === i.id);
      expect(i.registerAccelerator === false, i.id).toBe(Boolean(spec?.shortcut));
      expect(Boolean(i.accelerator), i.id).toBe(Boolean(spec?.shortcut));
    }
  });
  it('uses native roles for clipboard and quit', () => {
    const roles = flat(build('linux')).flatMap((i) => (i.role ? [i.role] : []));
    expect(roles).toEqual(expect.arrayContaining(['copy', 'paste', 'cut', 'selectAll', 'quit']));
    expect(flat(build('darwin')).some((i) => i.role === 'about')).toBe(true);
  });
  it('converts accelerators', () => {
    expect(toAccelerator('Mod-b')).toBe('CommandOrControl+B');
    expect(toAccelerator('Mod-Shift-Enter')).toBe('CommandOrControl+Shift+Enter');
    expect(toAccelerator('Mod-\\')).toBe('CommandOrControl+\\');
    expect(toAccelerator('F1')).toBe('F1');
    expect(toAccelerator('Mod-Alt-1')).toBe('CommandOrControl+Alt+1');
  });
});
