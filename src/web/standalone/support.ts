/** The parts of the browser's global scope that hosting the journal depends on. */
export interface FeatureScope {
  isSecureContext: boolean;
  navigator: Navigator;
  Worker?: unknown;
  WebAssembly?: unknown;
}

/**
 * What the browser must offer for the journal to live in it. Returns a sentence about what is
 * missing, or null when everything needed is there.
 */
export function missingFeature(scope: FeatureScope = globalThis): string | null {
  if (!scope.isSecureContext) return "This page isn't on a secure (HTTPS) connection.";
  if (scope.Worker === undefined) return "This browser can't run web workers.";
  if (scope.WebAssembly === undefined) return "This browser can't run WebAssembly.";
  if (
    !('storage' in scope.navigator) ||
    typeof scope.navigator.storage.getDirectory !== 'function'
  ) {
    return "This browser can't store files for Mossnote. Private windows often can't.";
  }
  return null;
}
