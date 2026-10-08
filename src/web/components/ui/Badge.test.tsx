// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './Badge';

afterEach(cleanup);

describe('Badge', () => {
  it('shows a count with a thousands separator', () => {
    render(<Badge count={1204} />);
    expect(screen.getByText('1,204')).toBeTruthy();
  });

  it('shows a status word', () => {
    render(<Badge status="Unread" />);
    expect(screen.getByText('Unread')).toBeTruthy();
  });
});
