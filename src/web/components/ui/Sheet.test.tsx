// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetViewportAfterEach, setViewport } from '../../testViewport';
import { Sheet } from './Sheet';

function Example() {
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
      <Sheet open={open} onOpenChange={setOpen} title="More">
        <button type="button">Inside</button>
      </Sheet>
    </>
  );
}

afterEach(cleanup);
resetViewportAfterEach();

describe('Sheet', () => {
  it('is a modal dialog named by its title, and a sheet at every width', async () => {
    for (const width of [375, 768, 1280]) {
      cleanup();
      setViewport(width);
      render(<Example />);
      await userEvent.click(screen.getByRole('button', { name: 'Open' }));
      const dialog = screen.getByRole('dialog', { name: 'More' });
      expect(dialog.getAttribute('data-presentation'), `${width}px`).toBe('sheet');
    }
  });

  it('closes on Escape and gives focus back', async () => {
    setViewport(375);
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
