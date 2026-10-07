import { useNavigate } from 'react-router';
import { useNewNote } from '../../app/NewNote';
import { useTerms } from '../settings/useLayout';
import { useAdvanceDay } from '../calendar/useAdvanceDay';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra words that also match, for example "journal" for Go to Journal. */
  keywords: string;
  hint?: string;
  run: () => void;
}

/**
 * Every shortcut action is also a palette command, so nothing depends on a keyboard layout
 *. `openDatePicker` focuses the Today header chip's picker.
 */
export function useCommands(options: { openDate: () => void }): PaletteCommand[] {
  const navigate = useNavigate();
  const terms = useTerms();
  const newNote = useNewNote();
  const day = useAdvanceDay();
  const go = (path: string) => () => {
    void navigate(path);
  };
  return [
    {
      id: 'new',
      label: 'New note',
      keywords: 'write capture add',
      hint: 'n',
      run: newNote.requestNewNote,
    },
    {
      id: 'today',
      label: `Go to ${terms.today.label}`,
      keywords: 'home',
      hint: 'g t',
      run: go('/'),
    },
    {
      id: 'journal',
      label: `Go to ${terms.journal.label}`,
      keywords: 'notes timeline',
      hint: 'g j',
      run: go('/journal'),
    },
    {
      id: 'people',
      label: `Go to ${terms.people.label}`,
      keywords: 'person',
      hint: 'g p',
      run: go('/people'),
    },
    {
      id: 'farm',
      label: `Go to ${terms.farm.label}`,
      keywords: 'plantings entries',
      hint: 'g f',
      run: go('/farm'),
    },
    {
      id: 'maps',
      label: `Go to ${terms.maps.label}`,
      keywords: 'sketch draw pins places',
      hint: 'g m',
      run: go('/maps'),
    },
    {
      id: 'settings',
      label: 'Go to Settings',
      keywords: 'preferences theme calendar',
      hint: 'g s',
      run: go('/settings'),
    },
    {
      id: 'set-date',
      label: 'Set in-game date',
      keywords: 'calendar day season year',
      hint: 'd s',
      run: options.openDate,
    },
    ...(day.canGoNext
      ? [
          {
            id: 'next-day',
            label: 'Next day',
            keywords: 'advance tomorrow',
            hint: 'd n',
            run: day.next,
          },
        ]
      : []),
    ...(day.canGoPrevious
      ? [
          {
            id: 'previous-day',
            label: 'Previous day',
            keywords: 'back yesterday',
            hint: 'd p',
            run: day.previous,
          },
        ]
      : []),
    {
      id: 'export',
      label: 'Export JSON',
      keywords: 'backup download data',
      run: () => {
        window.location.assign('/api/data/export.json');
      },
    },
  ];
}
