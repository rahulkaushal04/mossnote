// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddRow } from './AddRow';

afterEach(cleanup);

function Harness({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState('');
  return (
    <AddRow
      id="add-thing"
      label="Add a thing"
      placeholder="Add a thing…"
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      note={<p role="status">Note under the row</p>}
    />
  );
}

describe('AddRow', () => {
  it('names its field for screen readers, and shows the placeholder to everyone else', () => {
    render(<Harness onSubmit={vi.fn()} />);
    const field = screen.getByLabelText('Add a thing');
    expect(field.getAttribute('placeholder')).toBe('Add a thing…');
    expect(screen.getByText('Add a thing').className).toContain('sr-only');
  });

  it('submits with Enter and with the button, and shows the note slot', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Add a thing'), 'Leah{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toBe('Note under the row');
  });

  it('marks the field invalid when asked to', () => {
    render(
      <AddRow
        id="x"
        label="Add a thing"
        placeholder="…"
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        invalid
      />,
    );
    expect(screen.getByLabelText('Add a thing').getAttribute('aria-invalid')).toBe('true');
  });
});
