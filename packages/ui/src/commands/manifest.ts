/**
 * Every user command, as pure data. The palette, the shortcut list, the editor keymaps and the
 * desktop menu are all built from this list, so a shortcut cannot be defined twice. Keep this file
 * free of imports: the desktop main process and Node tests import it directly.
 * `Mod` means Cmd on macOS and Ctrl elsewhere.
 */
export type MenuName = 'File' | 'Edit' | 'View' | 'Note';

export interface CommandSpec {
  readonly id: string;
  readonly title: string;
  readonly shortcut?: string;
  readonly menu?: MenuName;
}

export const commands: readonly CommandSpec[] = [
  { id: 'note.new', title: 'New note', shortcut: 'Mod-N', menu: 'File' },
  { id: 'folder.new', title: 'New folder', menu: 'File' },
  { id: 'folder.rename', title: 'Rename folder', shortcut: 'F2', menu: 'Note' },
  { id: 'nav.all', title: 'Go to All notes', menu: 'View' },
  { id: 'nav.favorites', title: 'Go to Favorites', menu: 'View' },
  { id: 'nav.trash', title: 'Go to Trash', menu: 'View' },
  { id: 'capture.open', title: 'Quick capture', menu: 'File' },
  { id: 'note.trash', title: 'Move note to Trash', shortcut: 'Mod-Shift-Backspace', menu: 'Note' },
  { id: 'note.favorite', title: 'Toggle favorite', shortcut: 'Mod-Shift-D', menu: 'Note' },
  { id: 'trash.undo', title: 'Undo delete', menu: 'Edit' },
  { id: 'format.bold', title: 'Bold', shortcut: 'Mod-b', menu: 'Note' },
  { id: 'format.italic', title: 'Italic', shortcut: 'Mod-i', menu: 'Note' },
  { id: 'format.link', title: 'Link', shortcut: 'Mod-Alt-k', menu: 'Note' },
  { id: 'format.bullet', title: 'Bulleted list', shortcut: 'Mod-Shift-8', menu: 'Note' },
  { id: 'format.heading', title: 'Cycle heading level', shortcut: 'Mod-Alt-1', menu: 'Note' },
  { id: 'format.task', title: 'Toggle checklist item', shortcut: 'Mod-Shift-Enter', menu: 'Note' },
  { id: 'search.focus', title: 'Search notes', shortcut: 'Mod-Alt-f', menu: 'Edit' },
  { id: 'search.verify', title: 'Check search index' },
  { id: 'search.rebuild', title: 'Rebuild search index' },
  { id: 'attachments.add', title: 'Attach file…' },
  { id: 'attachments.cleanup', title: 'Clean up attachments…' },
  { id: 'attachments.verify', title: 'Verify attachments' },
  { id: 'view.palette', title: 'Command palette', shortcut: 'Mod-k', menu: 'View' },
  { id: 'view.toggleNav', title: 'Toggle sidebar', shortcut: 'Mod-\\', menu: 'View' },
  { id: 'view.focusMode', title: 'Distraction-free mode', shortcut: 'Mod-Shift-f', menu: 'View' },
  { id: 'view.shortcuts', title: 'Keyboard shortcuts', shortcut: 'F1', menu: 'View' },
  { id: 'theme.light', title: 'Theme: light', menu: 'View' },
  { id: 'theme.dark', title: 'Theme: dark', menu: 'View' },
  { id: 'theme.system', title: 'Theme: match system', menu: 'View' },
];
