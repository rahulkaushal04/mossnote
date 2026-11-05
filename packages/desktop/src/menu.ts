import type { CommandSpec, MenuName } from '@mossnote/ui/commands';
import type { MenuItemConstructorOptions } from 'electron';

export interface MenuOptions {
  platform: string;
  appName: string;
  /** Sends `{type:'command', id}` to the focused app window. */
  send(id: string): void;
}

/** Manifest shortcut ("Mod-Shift-l") to an Electron accelerator ("CommandOrControl+Shift+L"). */
export function toAccelerator(shortcut: string): string {
  const parts = shortcut.split(/-(?=.)/);
  return parts
    .map((p, i) => {
      if (p === 'Mod') return 'CommandOrControl';
      return i === parts.length - 1 && p.length === 1 ? p.toUpperCase() : p;
    })
    .join('+');
}

const ORDER: MenuName[] = ['File', 'Edit', 'View', 'Note'];

/**
 * Pure. Every manifest item with a `menu` appears once, keyed by its id. Items that have a renderer
 * keymap show their accelerator but do not register it, so a key never fires twice.
 */
export function buildMenuTemplate(
  commands: readonly CommandSpec[],
  o: MenuOptions,
): MenuItemConstructorOptions[] {
  const mac = o.platform === 'darwin';
  const items = (m: MenuName): MenuItemConstructorOptions[] =>
    commands
      .filter((c) => c.menu === m)
      .map((c) => ({
        id: c.id,
        label: c.title,
        ...(c.shortcut
          ? { accelerator: toAccelerator(c.shortcut), registerAccelerator: false }
          : {}),
        click: () => o.send(c.id),
      }));
  const sep: MenuItemConstructorOptions = { type: 'separator' };
  const roles: Record<MenuName, MenuItemConstructorOptions[]> = {
    File: [sep, { role: 'close' }, ...(mac ? [] : [{ role: 'quit' } as const])],
    Edit: [
      // CodeMirror owns undo/redo keys; the roles are shown but must not also fire natively.
      { role: 'undo', registerAccelerator: false },
      { role: 'redo', registerAccelerator: false },
      sep,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
    View: [sep, { role: 'togglefullscreen' }],
    Note: [],
  };
  const menus = ORDER.map((m): MenuItemConstructorOptions => {
    const own = items(m);
    // Edit lists native roles first, then app commands.
    const sub = m === 'Edit' ? [...roles.Edit, sep, ...own] : [...own, ...roles[m]];
    return { label: m, submenu: sub };
  });
  const app: MenuItemConstructorOptions[] = mac
    ? [
        {
          label: o.appName,
          submenu: [
            { role: 'about' },
            sep,
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            sep,
            { role: 'quit' },
          ],
        },
      ]
    : [];
  const windowMenu: MenuItemConstructorOptions = { role: 'windowMenu' };
  return [...app, ...menus, windowMenu];
}
