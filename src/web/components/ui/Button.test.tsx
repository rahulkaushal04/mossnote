// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { PlusIcon } from './icons';
import { TooltipProvider } from './Tooltip';

afterEach(cleanup);

describe('Button', () => {
  it('is a secondary button that does not submit a form by default', () => {
    render(<Button>Rename</Button>);
    const button = screen.getByRole('button', { name: 'Rename' });
    expect(button).toHaveProperty('type', 'button');
    expect(button.className).toContain('btn');
    expect(button.className).not.toContain('btn-primary');
  });

  it('maps each variant to its style', () => {
    render(
      <>
        <Button variant="primary">Save</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Delete</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('btn-primary');
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('btn-ghost');
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('btn-danger');
  });

  it('calls onClick, and not when disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('while busy is announced as busy, cannot be clicked again and keeps its label', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button busy icon={<PlusIcon data-testid="icon" />} onClick={onClick}>
        Add person
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Add person' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button).toHaveProperty('disabled', true);
    expect(screen.queryByTestId('icon')).toBeNull();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('is named by its label and calls onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <IconButton label="New note" icon={<PlusIcon />} onClick={onClick} />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows its name as a tooltip on keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <IconButton label="Undo" icon={<PlusIcon />} />
      </TooltipProvider>,
    );
    await user.tab();
    expect((await screen.findAllByText('Undo')).length).toBeGreaterThan(0);
  });

  it('can be a toggle', () => {
    render(
      <TooltipProvider>
        <IconButton label="Pan" icon={<PlusIcon />} pressed />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Pan' }).getAttribute('aria-pressed')).toBe('true');
  });
});
