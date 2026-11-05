import type { Bridge } from '@mossnote/core/rpc';

declare global {
  interface Window {
    mossnote?: Bridge;
  }
}

/** The preload's `window.mossnote`; tests inject their own loopback instead. */
export function getBridge(): Bridge {
  if (!window.mossnote) throw new Error('window.mossnote is missing (preload did not run)');
  return window.mossnote;
}
