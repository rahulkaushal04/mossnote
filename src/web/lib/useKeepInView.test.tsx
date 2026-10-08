// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeepInView } from './useKeepInView';

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  resize(height: number) {
    this.height = height;
    this.dispatchEvent(new Event('resize'));
  }
}

function Field() {
  const ref = useRef<HTMLTextAreaElement>(null);
  useKeepInView(ref);
  return <textarea ref={ref} aria-label="Note" />;
}

const scrollIntoView = vi.fn();
let viewport: FakeViewport;

beforeEach(() => {
  viewport = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'visualViewport');
});

describe('useKeepInView', () => {
  it('scrolls the focused field into view when the keyboard opens', () => {
    const { getByLabelText } = render(<Field />);
    getByLabelText('Note').focus();
    act(() => {
      viewport.resize(450);
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('leaves the page alone when the field is not focused', () => {
    render(<Field />);
    act(() => {
      viewport.resize(450);
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
