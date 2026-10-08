// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useKeyboardInset } from './useKeyboardInset';

/** A stand-in for window.visualViewport that a test can resize, like the keyboard opening. */
class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  resize(height: number, offsetTop = 0): void {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event('resize'));
  }
}

function install(viewport: FakeViewport | undefined): void {
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport');
});

describe('useKeyboardInset', () => {
  it('is 0 while the whole window is visible', () => {
    install(new FakeViewport());
    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBe(0);
  });

  it('is how much of the window the keyboard covers once it opens, and 0 again when it closes', () => {
    const viewport = new FakeViewport();
    install(viewport);
    const { result } = renderHook(() => useKeyboardInset());
    act(() => {
      viewport.resize(500);
    });
    expect(result.current).toBe(300);
    act(() => {
      viewport.resize(800);
    });
    expect(result.current).toBe(0);
  });

  it('ignores a small change, such as the browser toolbar sliding away', () => {
    const viewport = new FakeViewport();
    install(viewport);
    const { result } = renderHook(() => useKeyboardInset());
    act(() => {
      viewport.resize(760);
    });
    expect(result.current).toBe(0);
  });

  it('is 0 where the browser has no visual viewport', () => {
    install(undefined);
    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBe(0);
  });
});
