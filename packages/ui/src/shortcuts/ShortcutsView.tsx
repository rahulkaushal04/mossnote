import { commands as manifest, type CommandSpec } from '../commands/manifest';
import { useModal } from '../dialog/useModal';
import { detectPlatform, formatShortcut, type Platform } from './keys';
import '../palette/palette.css';

/** Keys CodeMirror owns that the manifest cannot know about. Documented, not rebound. */
export const FIXED_KEYS: readonly { keys: string; title: string }[] = [
  { keys: 'Escape then Tab', title: 'Leave the editor (Tab otherwise indents)' },
  { keys: 'Mod-z', title: 'Undo' },
  { keys: 'Mod-Shift-z', title: 'Redo' },
  { keys: 'Ctrl-m', title: 'Toggle Tab key focus mode (Shift-Alt-m on macOS)' },
];

export interface ShortcutsViewProps {
  onClose(): void;
  platform?: Platform;
  specs?: readonly CommandSpec[];
}

/** Mounted by the shell when `view.shortcuts` (F1) runs; F1 or Esc closes it. */
export function ShortcutsView({
  onClose,
  platform = detectPlatform(),
  specs = manifest,
}: ShortcutsViewProps) {
  const { ref, onKeyDown: onModalKey } = useModal(onClose);
  const rows = [
    ...specs
      .filter((s) => s.shortcut)
      .map((s) => ({ title: s.title, keys: formatShortcut(s.shortcut!, platform) })),
    ...FIXED_KEYS.map((k) => ({
      title: k.title,
      keys: /^(Mod|Ctrl)-/.test(k.keys) ? formatShortcut(k.keys, platform) : k.keys,
    })),
  ];
  return (
    <div className="mn-palette-backdrop">
      <div
        ref={ref}
        className="mn-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-shortcuts-title"
        onKeyDown={(e) => (e.key === 'F1' ? (e.preventDefault(), onClose()) : onModalKey(e))}
      >
        <h2 id="mn-shortcuts-title">Keyboard shortcuts</h2>
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.title}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 'normal' }}>
                  {r.title}
                </th>
                <td>
                  <kbd>{r.keys}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
