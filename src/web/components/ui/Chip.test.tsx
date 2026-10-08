// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chip, RemovableChip } from './Chip';

afterEach(cleanup);

describe('Chip', () => {
  it('is a pill toggle with aria-pressed that shows a check when selected', () => {
    render(
      <Chip selected onToggle={() => undefined}>
        Not dated
      </Chip>,
    );
    const button = screen.getByRole('button', { name: 'Not dated' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.className).toContain('pill');
    expect(button.querySelector('svg')).not.toBeNull();
  });
});

describe('RemovableChip', () => {
  it('names the removal and calls back when pressed', async () => {
    const onRemove = vi.fn();
    render(
      <RemovableChip label="#crops" removeLabel="Remove tag filter crops" onRemove={onRemove} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag filter crops' }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(screen.getByText('#crops')).toBeTruthy();
  });
});
