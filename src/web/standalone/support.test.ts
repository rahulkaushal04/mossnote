import { describe, expect, it } from 'vitest';
import { missingFeature, type FeatureScope } from './support';

const scope = (overrides: Partial<Record<keyof FeatureScope, unknown>> = {}): FeatureScope =>
  ({
    isSecureContext: true,
    navigator: { storage: { getDirectory: () => Promise.resolve({}) } },
    Worker: () => undefined,
    WebAssembly: {},
    ...overrides,
  }) as FeatureScope;

describe('missingFeature', () => {
  it('finds nothing missing in a browser that has everything', () => {
    expect(missingFeature(scope())).toBeNull();
  });

  it('asks for a secure connection', () => {
    expect(missingFeature(scope({ isSecureContext: false }))).toMatch(
      /secure \(HTTPS\) connection/,
    );
  });

  it('notices a browser with no workers or no WebAssembly', () => {
    expect(missingFeature(scope({ Worker: undefined }))).toMatch(/web workers/);
    expect(missingFeature(scope({ WebAssembly: undefined }))).toMatch(/WebAssembly/);
  });

  it('notices a browser with no file storage, such as a private window', () => {
    expect(missingFeature(scope({ navigator: {} }))).toMatch(/can.t store files/);
    expect(missingFeature(scope({ navigator: { storage: {} } }))).toMatch(/can.t store files/);
  });
});
