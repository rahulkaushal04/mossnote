// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, type ToastOptions } from './Toast';

function Harness({ options }: { options: ToastOptions }) {
  const toast = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          toast.show(options);
        }}
      >
        show
      </button>
      <input aria-label="field" />
    </>
  );
}

const setup = (options: ToastOptions) =>
  render(
    <ToastProvider>
      <Harness options={options} />
    </ToastProvider>,
  );

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('announces the message in a polite status region', async () => {
    setup({ message: 'Note deleted' });
    await userEvent.click(screen.getByText('show'));
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Note deleted');
  });

  it('runs the action and closes when Undo is activated', async () => {
    const onAction = vi.fn();
    setup({ message: 'Note deleted', actionLabel: 'Undo', onAction });
    await userEvent.click(screen.getByText('show'));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Note deleted')).toBeNull();
  });

  it('Undo is reachable with Tab and the keyboard', async () => {
    const onAction = vi.fn();
    setup({ message: 'Note deleted', actionLabel: 'Undo', onAction });
    await userEvent.click(screen.getByText('show'));
    screen.getByRole('button', { name: 'Undo' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('pressing u runs Undo while the toast is visible', async () => {
    const onAction = vi.fn();
    setup({ message: 'Note deleted', actionLabel: 'Undo', onAction });
    await userEvent.click(screen.getByText('show'));
    await userEvent.keyboard('u');
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Note deleted')).toBeNull();
  });

  it('ignores u while typing, with a modifier, or when there is no action', async () => {
    const onAction = vi.fn();
    setup({ message: 'Note deleted', actionLabel: 'Undo', onAction });
    await userEvent.click(screen.getByText('show'));
    await userEvent.type(screen.getByLabelText('field'), 'u');
    fireEvent.keyDown(document.body, { key: 'u', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'u', metaKey: true });
    expect(onAction).not.toHaveBeenCalled();
    cleanup();

    setup({ message: 'Plain message' });
    await userEvent.click(screen.getByText('show'));
    await userEvent.keyboard('u');
    expect(screen.getByText('Plain message')).toBeTruthy();
  });

  it('disappears after 8 seconds by default', () => {
    vi.useFakeTimers();
    setup({ message: 'Note deleted' });
    fireEvent.click(screen.getByText('show'));
    expect(screen.queryByText('Note deleted')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(7999);
    });
    expect(screen.queryByText('Note deleted')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.queryByText('Note deleted')).toBeNull();
  });

  it('pauses on hover and on focus', () => {
    vi.useFakeTimers();
    setup({ message: 'Note deleted', actionLabel: 'Undo', onAction: () => undefined });
    fireEvent.click(screen.getByText('show'));
    const message = screen.getByText('Note deleted');

    fireEvent.mouseEnter(message);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByText('Note deleted')).not.toBeNull();
    fireEvent.mouseLeave(message);
    act(() => {
      vi.advanceTimersByTime(8001);
    });
    expect(screen.queryByText('Note deleted')).toBeNull();
  });

  it('pauses while the Undo button has focus', () => {
    vi.useFakeTimers();
    setup({ message: 'Note deleted', actionLabel: 'Undo', onAction: () => undefined });
    fireEvent.click(screen.getByText('show'));
    fireEvent.focus(screen.getByRole('button', { name: 'Undo' }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByText('Note deleted')).not.toBeNull();
  });

  it('uses role=alert for blocking errors', async () => {
    setup({ message: 'Could not save', tone: 'alert' });
    await userEvent.click(screen.getByText('show'));
    expect(screen.getByRole('alert').textContent).toContain('Could not save');
  });

  it('honours a custom duration', () => {
    vi.useFakeTimers();
    setup({ message: 'Quick', duration: 1000 });
    fireEvent.click(screen.getByText('show'));
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.queryByText('Quick')).toBeNull();
  });
});
