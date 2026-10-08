import { useSyncExternalStore } from 'react';
import { BASE_PATH } from './mode';

/**
 * Which journal this window is showing. The server has one journal open at a time, so every
 * request names the journal the window believes it is showing; if another window switched in the
 * meantime the server refuses, and `useJournalChanged` tells the window to reload.
 */
let current: string | null = null;
let changed = false;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

export const currentJournalId = (): string | null => current;

export function setCurrentJournal(id: string | null): void {
  current = id;
}

/** Another window switched journals (or the server refused this window's journal). */
export function markJournalChanged(): void {
  if (changed) return;
  changed = true;
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useJournalChanged = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => changed,
    () => false,
  );

/** Whole-page navigation, in one object so tests can replace it. */
export const journalNav = {
  /** Load the app afresh on whichever journal is open now. */
  show(): void {
    window.location.assign(BASE_PATH);
  },
  /** Reload the page you are on. */
  reload(): void {
    window.location.reload();
  },
};

/** The one place a switch ends: a clean load of the app on the new journal. */
export const showJournal = (): void => {
  journalNav.show();
};

/** Back to a clean slate between tests. */
export function resetJournalState(): void {
  current = null;
  changed = false;
  notify();
}
