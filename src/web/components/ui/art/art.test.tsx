// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as art from './index';

describe('empty-state art', () => {
  for (const [name, Art] of Object.entries(art)) {
    it(`${name} is one decorative, single-colour line drawing`, () => {
      const { container } = render(<Art />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('stroke')).toBe('currentColor');
      for (const el of container.querySelectorAll('svg *')) {
        expect(['none', null]).toContain(el.getAttribute('fill'));
        expect(['currentColor', null]).toContain(el.getAttribute('stroke'));
      }
    });
  }
});
