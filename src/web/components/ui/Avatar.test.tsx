// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar, avatarTint, initialOf } from './Avatar';

afterEach(cleanup);

describe('Avatar', () => {
  it('shows the first letter, upper case, and is hidden from screen readers', () => {
    const { container } = render(<Avatar name="abigail" />);
    const el = container.firstElementChild;
    expect(el?.textContent).toBe('A');
    expect(el?.getAttribute('aria-hidden')).toBe('true');
  });

  it('skips leading punctuation and falls back to a dot for an empty name', () => {
    expect(initialOf('  "linus')).toBe('L');
    expect(initialOf('')).toBe('·');
  });

  it('picks the same tint for the same name, and only known tints', () => {
    expect(avatarTint('Haley')).toBe(avatarTint('Haley'));
    expect([0, 1]).toContain(avatarTint('Sebastian'));
  });
});
