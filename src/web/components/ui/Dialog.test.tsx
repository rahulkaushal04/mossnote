// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetViewportAfterEach, setViewport } from '../../testViewport';
import { Dialog } from './Dialog';

function Example({ description }: { description?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Example title"
        {...(description ? { description } : {})}
      >
        <button type="button">Inside</button>
      </Dialog>
    </>
  );
}

afterEach(cleanup);
resetViewportAfterEach();

describe('Dialog', () => {
  it('is a modal dialog named by its title', async () => {
    render(<Example description="Some detail" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Example title' });
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByText('Some detail')).toBeTruthy();
  });

  it('moves focus inside, closes on Escape, and returns focus to the trigger', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab inside the dialog', async () => {
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes with the Close button', async () => {
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Dialog presentation', () => {
  const open = async () => {
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    return screen.getByRole('dialog');
  };

  it('is a bottom sheet with a drag handle on a phone', async () => {
    setViewport(375);
    const dialog = await open();
    expect(dialog.getAttribute('data-presentation')).toBe('sheet');
    expect(dialog.querySelector('[data-sheet-handle]')).not.toBeNull();
  });

  it('is a centred panel without a handle on a tablet and on wide screens', async () => {
    for (const width of [768, 1280]) {
      cleanup();
      setViewport(width);
      const dialog = await open();
      expect(dialog.getAttribute('data-presentation'), `${width}px`).toBe('panel');
      expect(dialog.querySelector('[data-sheet-handle]')).toBeNull();
    }
  });
});
