/** Set by vite.config.ts: true in development and in `--mode e2e` builds only. */
declare const __MOSS_DEV_KIT__: boolean;

/**
 * Set by vite.config.ts: true only in the build that runs the journal inside the browser
 * (`npm run build:standalone`), where there is no server and journals live in browser storage.
 */
declare const __MOSS_STANDALONE__: boolean;

interface Window {
  /** Read by the style injector inside Radix (react-style-singleton via get-nonce). */
  __webpack_nonce__?: string;
}
