// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ListRow } from './ListRow';

afterEach(cleanup);

describe('ListRow', () => {
  it('is a link with the title, a right-aligned meta and an avatar', () => {
    render(
      <MemoryRouter>
        <ListRow to="/people/1" title="Abigail" meta="3 notes" leading="Abigail" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Abigail/ });
    expect(link.getAttribute('href')).toBe('/people/1');
    expect(screen.getByText('3 notes').className).toContain('list-row-meta');
    expect(link.textContent).toContain('A');
  });

  it('is a plain row when it has no destination', () => {
    render(<ListRow title="Parsnips" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Parsnips')).toBeTruthy();
  });
});
