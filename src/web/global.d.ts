/** Set by vite.config.ts: true in development and in `--mode e2e` builds only. */
declare const __MOSS_DEV_KIT__: boolean;

interface Window {
  /** Read by the style injector inside Radix (react-style-singleton via get-nonce). */
  __webpack_nonce__?: string;
}
