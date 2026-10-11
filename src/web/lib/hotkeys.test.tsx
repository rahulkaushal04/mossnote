// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHotkeys } from './hotkeys';

function Harness({ onKey, inTextFields }: { onKey: () => void; inTextFields?: boolean }) {
  useHotkeys({ '$mod+k': onKey }, inTextFields === undefined ? {} : { inTextFields });
  return <textarea aria-label="Note" />;
}

const pressInNote = (container: HTMLElement) => {
  const box = container.querySelector('textarea')!;
  box.focus();
  fireEvent.keyDown(box, { key: 'k', code: 'KeyK', ctrlKey: true });
};

afterEach(cleanup);

describe('useHotkeys', () => {
  it('ignores a shortcut pressed inside a text field by default', () => {
    const onKey = vi.fn();
    const { container } = render(<Harness onKey={onKey} />);

    pressInNote(container);

    expect(onKey).not.toHaveBeenCalled();
  });

  it('runs a shortcut pressed inside a text field when asked to', () => {
    const onKey = vi.fn();
    const { container } = render(<Harness onKey={onKey} inTextFields />);

    pressInNote(container);

    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('does not run a held-down key twice', () => {
    const onKey = vi.fn();
    const { container } = render(<Harness onKey={onKey} inTextFields />);
    const box = container.querySelector('textarea')!;

    fireEvent.keyDown(box, { key: 'k', code: 'KeyK', ctrlKey: true, repeat: true });

    expect(onKey).not.toHaveBeenCalled();
  });
});
