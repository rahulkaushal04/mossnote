import { useState } from 'react';
import type { Note } from '@shared/types';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EllipsisIcon } from '../../components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/Menu';
import { useDeleteNote, useUpdateNoteOptimistic } from './hooks';

/** The “…” menu (spec section 5.2): title, date, flags, link, delete. */
export function NoteMenu({
  note,
  onEdit,
  onSetDate,
}: {
  note: Note;
  onEdit: (action?: 'title' | 'link') => void;
  onSetDate: () => void;
}) {
  const remove = useDeleteNote();
  const update = useUpdateNoteOptimistic();
  const [confirmUnflag, setConfirmUnflag] = useState(false);

  const toggleDiscovery = () => {
    update.mutate({
      note,
      optimistic: { ...note, isDiscovery: !note.isDiscovery },
      patch: { isDiscovery: !note.isDiscovery },
    });
  };
  const setQuestion = (on: boolean) => {
    update.mutate({
      note,
      optimistic: {
        ...note,
        question: on
          ? { state: 'open', resolution: null, solvedGameDate: null, solvedAt: null }
          : null,
      },
      patch: { question: on ? { state: 'open' } : null },
    });
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className="tap rounded-control px-1 text-ink-muted hover:bg-surface hover:text-ink"
          >
            <EllipsisIcon />
          </button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem
            onSelect={() => {
              onEdit();
            }}
          >
            Edit
          </MenuItem>
          <MenuItem
            onSelect={() => {
              onEdit('title');
            }}
          >
            {note.title ? 'Edit title' : 'Add title'}
          </MenuItem>
          <MenuItem onSelect={onSetDate}>Set date</MenuItem>
          <MenuItem onSelect={toggleDiscovery}>
            {note.isDiscovery ? 'Remove discovery' : 'Mark as discovery'}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              if (!note.question) setQuestion(true);
              else if (note.question.resolution) setConfirmUnflag(true);
              else setQuestion(false);
            }}
          >
            {note.question ? 'Remove question' : 'Mark as question'}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              onEdit('link');
            }}
          >
            Add link
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            danger
            onSelect={() => {
              remove.mutate(note);
            }}
          >
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={confirmUnflag}
        onOpenChange={setConfirmUnflag}
        title="Remove the question?"
        message="This note has an answer. Removing the ? flag clears the question and its answer."
        confirmLabel="Remove question"
        danger
        onConfirm={() => {
          setQuestion(false);
        }}
      />
    </>
  );
}
