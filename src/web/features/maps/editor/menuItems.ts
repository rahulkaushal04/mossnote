/** The right-click menu: one list for an object, another for empty canvas. */
import { getClip, getStyleClip } from '../clipboardStore';
import type { MenuItems } from '../ContextMenu';
import type { Actions, EditorSettings } from '../editorTypes';
import type { Clip } from '../engine/doc';
import type { Objects } from '../engine/shapes';

interface MenuContext {
  /** The object that was right-clicked, or null for empty canvas. */
  target: string | null;
  /** Where the click landed on the map. */
  world: [number, number];
  objs: Objects;
  selectionSize: number;
  actions: Actions;
  settings: EditorSettings;
  setSettings: (patch: Partial<EditorSettings>) => void;
  openPinSheet: (id: string) => void;
  editText: (id: string) => void;
  pasteAt: (clip: Clip, at: readonly [number, number]) => void;
  fitAll: () => void;
}

export function buildMenuItems(c: MenuContext): MenuItems {
  const { actions } = c;
  if (c.target) {
    const target = c.target;
    const info = c.objs.get(target);
    return [
      ...(info?.kind === 'pin'
        ? [
            {
              label: 'Details…',
              keys: 'Enter',
              run: () => {
                c.openPinSheet(target);
              },
            },
          ]
        : []),
      ...(info?.shape?.t === 'text'
        ? [
            {
              label: 'Edit text',
              keys: 'Enter',
              run: () => {
                c.editText(target);
              },
            },
          ]
        : []),
      {
        label: 'Rename',
        keys: 'F2',
        run: () => {
          actions.rename();
        },
      },
      {
        label: 'Add a note card',
        run: () => {
          actions.addNote(target);
        },
      },
      'sep',
      { label: 'Duplicate', keys: 'Mod+D', run: actions.duplicate },
      { label: 'Copy', keys: 'Mod+C', run: actions.copy },
      { label: 'Cut', keys: 'Mod+X', run: actions.cut },
      { label: 'Paste', keys: 'Mod+V', disabled: getClip() === null, run: actions.paste },
      'sep',
      { label: 'Group', keys: 'Mod+G', disabled: c.selectionSize < 2, run: actions.group },
      { label: 'Ungroup', keys: 'Mod+⇧G', run: actions.ungroup },
      {
        label: 'Bring to front',
        keys: 'Mod+⇧]',
        run: () => {
          actions.order('front');
        },
      },
      {
        label: 'Send to back',
        keys: 'Mod+⇧[',
        run: () => {
          actions.order('back');
        },
      },
      'sep',
      {
        label: 'Lock',
        keys: 'Mod+⇧L',
        run: () => {
          actions.setLocked(true);
        },
      },
      {
        label: 'Hide',
        keys: 'Mod+⇧H',
        run: () => {
          actions.setHidden(true);
        },
      },
      { label: 'Copy style', run: actions.copyStyle },
      { label: 'Paste style', disabled: getStyleClip() === null, run: actions.pasteStyle },
      'sep',
      { label: 'Delete', keys: 'Del', danger: true, run: actions.remove },
    ];
  }
  return [
    {
      label: 'Paste',
      keys: 'Mod+V',
      disabled: getClip() === null,
      run: () => {
        const clip = getClip();
        if (clip) c.pasteAt(clip, c.world);
      },
    },
    { label: 'Select all', keys: 'Mod+A', run: actions.selectAll },
    'sep',
    { label: 'Fit the whole map', keys: '⇧1', run: c.fitAll },
    {
      label: c.settings.grid ? 'Hide the grid' : 'Show the grid',
      keys: '⇧G',
      run: () => {
        c.setSettings({ grid: !c.settings.grid });
      },
    },
    {
      label: c.settings.snap ? 'Turn snapping off' : 'Turn snapping on',
      keys: '⇧S',
      run: () => {
        c.setSettings({ snap: !c.settings.snap });
      },
    },
  ];
}
