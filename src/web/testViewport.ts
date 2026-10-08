import { afterEach } from 'vitest';

/** Evaluate the width queries the app uses against a pretend viewport width. */
function matches(query: string, width: number): boolean {
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return width <= Number(max[1]);
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return width >= Number(min[1]);
  return false;
}

/**
 * Make `matchMedia` answer as if the window were `width` CSS pixels wide. jsdom has no layout,
 * so this is how a test puts the app at a phone, tablet or wide size. Reset after every test.
 */
export function setViewport(width: number): void {
  window.matchMedia = (query: string) => ({
    matches: matches(query, width),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}

/** Call once in a test file that uses setViewport, so one test's size never leaks into the next. */
export function resetViewportAfterEach(): void {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });
}
