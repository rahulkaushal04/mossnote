// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLongPress } from './useLongPress';

function Probe({ onLong, onClick }: { onLong: () => void; onClick: () => void }) {
  const press = useLongPress(onLong);
  return (
    <button type="button" onClick={onClick} {...press}>
      Tool
    </button>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useLongPress', () => {
  it('fires after a touch is held, and swallows the click that follows', () => {
    const onLong = vi.fn();
    const onClick = vi.fn();
    render(<Probe onLong={onLong} onClick={onClick} />);
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onLong).toHaveBeenCalledOnce();
    fireEvent.pointerUp(button, { pointerType: 'touch' });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does nothing for a quick tap', () => {
    const onLong = vi.fn();
    const onClick = vi.fn();
    render(<Probe onLong={onLong} onClick={onClick} />);
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerUp(button, { pointerType: 'touch' });
    fireEvent.click(button);
    expect(onLong).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('ignores a mouse, which has hover tooltips instead', () => {
    const onLong = vi.fn();
    render(<Probe onLong={onLong} onClick={() => undefined} />);
    fireEvent.pointerDown(screen.getByRole('button'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(onLong).not.toHaveBeenCalled();
  });

  it('cancels when the finger leaves', () => {
    const onLong = vi.fn();
    render(<Probe onLong={onLong} onClick={() => undefined} />);
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    fireEvent.pointerLeave(button, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(onLong).not.toHaveBeenCalled();
  });
});
