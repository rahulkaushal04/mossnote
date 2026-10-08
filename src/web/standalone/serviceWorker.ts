import { useSyncExternalStore } from 'react';
import { BASE_PATH } from '../lib/mode';

/**
 * The service worker that lets the standalone web app open with no network. It keeps a copy of
 * every file of the app. A new version is fetched in the background and waits: the app tells the
 * person and switches over when they agree, so a page is never half old and half new.
 */

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

function watch(registration: ServiceWorkerRegistration): void {
  const check = (worker: ServiceWorker | null) => {
    // A first install is not an update: there is no older version on screen.
    if (worker?.state !== 'installed' || navigator.serviceWorker.controller === null) return;
    waiting = worker;
    notify();
  };
  check(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      check(installing);
    });
  });
}

/**
 * Register the service worker. Does nothing where service workers do not exist, and in
 * development, where there is no built worker file to register.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register(`${BASE_PATH}sw.js`, { scope: BASE_PATH })
    .then(watch)
    .catch(() => undefined);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** True once a newer version of the app is downloaded and waiting. */
export const useUpdateReady = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => waiting !== null,
    () => false,
  );

/** Switch to the waiting version and reload on it. */
export function applyUpdate(): void {
  if (waiting === null) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
