import { useNavigate } from 'react-router';
import { useAdvanceDay } from '../features/calendar/useAdvanceDay';
import { usePalette } from '../features/search/PaletteProvider';
import { singleKey, useHotkeys } from '../lib/hotkeys';
import { useUsesSection } from '../features/settings/useLayout';
import { useNewNote } from './NewNote';
import { useOpenSetDate } from './SetDate';

/**
 * The global shortcuts. `mod+K` works everywhere, including text fields; every
 * single-key shortcut is inactive while typing, in dialogs and menus, with a modifier held, and
 * when the user turned single-key shortcuts off. Each one also exists as a palette command.
 */
export function GlobalHotkeys({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const navigate = useNavigate();
  const palette = usePalette();
  const newNote = useNewNote();
  const day = useAdvanceDay();
  const openSetDate = useOpenSetDate();
  const usesFarm = useUsesSection('farm');
  const go = (path: string) =>
    singleKey(() => {
      void navigate(path);
    });

  useHotkeys({
    '$mod+k': (event) => {
      event.preventDefault();
      palette.openPalette();
    },
    '/': singleKey((event) => {
      event.preventDefault();
      palette.openPalette();
    }),
    n: singleKey((event) => {
      event.preventDefault();
      newNote.requestNewNote();
    }),
    'g t': go('/'),
    'g j': go('/journal'),
    'g p': go('/people'),
    ...(usesFarm ? { 'g f': go('/farm') } : {}),
    'g m': go('/maps'),
    'g s': go('/settings'),
    'd n': singleKey(day.next),
    'd p': singleKey(day.previous),
    'd s': singleKey(openSetDate),
    '?': singleKey(onShowShortcuts, { allowShift: true }),
    'Shift+?': singleKey(onShowShortcuts, { allowShift: true }),
  });
  return null;
}
