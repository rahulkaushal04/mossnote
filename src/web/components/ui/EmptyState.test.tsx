// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';
import { PeopleIcon } from './icons';

afterEach(cleanup);

describe('EmptyState', () => {
  it('shows its sentence as one piece of text, so existing copy still reads the same', () => {
    render(<EmptyState>No notes yet. Write one above.</EmptyState>);
    expect(screen.getByText('No notes yet. Write one above.')).toBeTruthy();
  });

  it('can carry a decorative icon and a next-step action', () => {
    render(
      <EmptyState icon={<PeopleIcon />} action={<button type="button">Add a name</button>}>
        Nobody yet.
      </EmptyState>,
    );
    expect(screen.getByRole('button', { name: 'Add a name' })).toBeTruthy();
    expect(document.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('has no icon or action when none is given', () => {
    render(<EmptyState>Quiet.</EmptyState>);
    expect(document.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
