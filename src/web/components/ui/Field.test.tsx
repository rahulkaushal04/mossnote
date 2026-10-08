// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chip } from './Chip';
import { Field } from './Field';
import { Segmented } from './Segmented';

afterEach(cleanup);

describe('Field', () => {
  it('labels the control, so it is never named by its placeholder', () => {
    render(<Field label="Name">{(p) => <input {...p} />}</Field>);
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it('links the hint to the control', () => {
    render(
      <Field label="Name" hint="Shown in the switcher">
        {(p) => <input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Name');
    const hint = screen.getByText('Shown in the switcher');
    expect(input.getAttribute('aria-describedby')).toContain(hint.id);
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('marks the control invalid and announces the error', () => {
    render(
      <Field label="Name" hint="Shown in the switcher" error="Give it a name.">
        {(p) => <input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = screen.getByText('Give it a name.');
    expect(error.getAttribute('role')).toBe('alert');
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
  });
});

describe('Chip', () => {
  it('is a toggle with aria-pressed, and shows a check when selected', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Chip selected={false} onToggle={onToggle}>
        Questions
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Questions' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.querySelector('svg')).toBeNull();
    await user.click(chip);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(
      <Chip selected onToggle={onToggle}>
        Questions
      </Chip>,
    );
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.querySelector('svg')).not.toBeNull();
  });

  it('is plain text, not a button, when it does nothing', () => {
    render(<Chip>#tools</Chip>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('#tools')).toBeTruthy();
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  it('is a labelled radio group with the current value checked', () => {
    render(<Segmented label="Theme" value="light" options={options} onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveProperty('checked', false);
  });

  it('reports a change, and the arrow keys move between options', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Segmented label="Theme" value="light" options={options} onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).toHaveBeenCalledWith('dark');
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('dark');
  });
});
