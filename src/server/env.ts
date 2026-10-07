/** Hono environment shared by the app and its routes. */
export interface Env {
  Variables: {
    requestId: string;
    /** Set when an HTML document is served: the per-response nonce for `style-src`. */
    cspNonce?: string;
  };
}
