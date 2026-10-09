// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyReadingSize,
  applyTheme,
  applyTint,
  setReadingSize,
  setTheme,
  watchSystemTheme,
} from './theme';

function mockMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  const state = { dark };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') ? state.dark : false,
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
  return {
    set(next: boolean) {
      state.dark = next;
      listeners.forEach((l) => {
        l();
      });
    },
  };
}

const theme = () => document.documentElement.getAttribute('data-theme');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-reading');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme-color meta', () => {
  const color = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

  it('matches the paper colour of the applied theme', () => {
    mockMatchMedia(false);
    applyTheme('dark');
    expect(color()).toBe('#141816');
    applyTheme('light');
    expect(color()).toBe('#f7f5f0');
  });

  it('keeps a single meta tag', () => {
    mockMatchMedia(false);
    applyTheme('dark');
    applyTheme('light');
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });
});

describe('theme', () => {
  it('follows the system when the choice is System', () => {
    const media = mockMatchMedia(true);
    applyTheme();
    expect(theme()).toBe('dark');
    const stop = watchSystemTheme();
    media.set(false);
    expect(theme()).toBe('light');
    media.set(true);
    expect(theme()).toBe('dark');
    stop();
  });

  it('applies and stores an explicit choice, which beats the system', () => {
    mockMatchMedia(true);
    setTheme('light');
    expect(theme()).toBe('light');
    expect(localStorage.getItem('moss:theme')).toBe('light');
    setTheme('dark');
    expect(theme()).toBe('dark');
  });

  it('stops following the system once an explicit choice is made', () => {
    const media = mockMatchMedia(false);
    setTheme('dark');
    const stop = watchSystemTheme();
    media.set(false);
    expect(theme()).toBe('dark');
    stop();
  });

  it('treats an unknown stored value as System', () => {
    mockMatchMedia(false);
    localStorage.setItem('moss:theme', 'purple');
    applyTheme();
    expect(theme()).toBe('light');
  });

  it('keeps working when localStorage throws', () => {
    mockMatchMedia(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      applyTheme();
    }).not.toThrow();
    expect(() => {
      setTheme('dark');
    }).not.toThrow();
    expect(theme()).toBe('dark');
  });
});

describe('reading size', () => {
  it('applies the attribute and caches it for the next load', () => {
    applyReadingSize('large');
    expect(document.documentElement.getAttribute('data-reading')).toBe('large');
    setReadingSize('large');
    expect(JSON.parse(localStorage.getItem('moss:ui') ?? '{}')).toEqual({ readingSize: 'large' });
    setReadingSize('comfortable');
    expect(document.documentElement.getAttribute('data-reading')).toBe('comfortable');
  });
});

describe('theme-init.js (runs before first paint)', () => {
  const run = async () => {
    const { readFileSync } = await import('node:fs');
    // Tests run from the repository root.
    const code = readFileSync('src/web/public/theme-init.js', 'utf8');
    const { runInNewContext } = await import('node:vm');
    runInNewContext(code, {
      document,
      localStorage,
      window: { matchMedia: globalThis.matchMedia.bind(globalThis) },
    });
  };

  it('sets the theme and reading size from storage', async () => {
    mockMatchMedia(false);
    localStorage.setItem('moss:theme', 'dark');
    localStorage.setItem('moss:ui', JSON.stringify({ readingSize: 'large' }));
    await run();
    expect(theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-reading')).toBe('large');
  });

  it('follows the system by default and survives bad storage', async () => {
    mockMatchMedia(true);
    localStorage.setItem('moss:ui', '{not json');
    await run();
    expect(theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-reading')).toBe('comfortable');
  });
});

describe('applyTint', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-tint');
  });

  it('sets the tint on the document and remembers it for the next first paint', () => {
    applyTint('plum');
    expect(document.documentElement.getAttribute('data-tint')).toBe('plum');
    expect(localStorage.getItem('moss:tint')).toBe('plum');
  });

  it('does not touch the cache that holds the reading size', () => {
    localStorage.setItem('moss:ui', JSON.stringify({ readingSize: 'large' }));
    applyTint('moss');
    expect(JSON.parse(localStorage.getItem('moss:ui') ?? '{}')).toEqual({ readingSize: 'large' });
  });
});
