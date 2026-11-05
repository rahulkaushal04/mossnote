// USER-RUN. C3: the CSP must hold on a file: page, so an injected inline script must not run.
import { expect, test } from '@playwright/test';
import { launch, newDataDir } from './launch.ts';

test('inline script and remote fetch are blocked by the CSP', async () => {
  const { app, win } = await launch(newDataDir());
  try {
    const result = await win.evaluate(async () => {
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        violations.push(e.violatedDirective),
      );
      const s = document.createElement('script');
      s.textContent = 'window.__pwned = 1';
      document.body.appendChild(s);
      const fetched = await fetch('https://example.com/').then(
        () => 'allowed',
        () => 'blocked',
      );
      await new Promise((r) => setTimeout(r, 100));
      return { pwned: (window as unknown as { __pwned?: number }).__pwned, violations, fetched };
    });
    expect(result.pwned).toBeUndefined();
    expect(result.violations.some((v) => v.startsWith('script-src'))).toBe(true);
    expect(result.fetched).toBe('blocked');
    // The policy is in the page itself, not only in a header hook.
    const meta = await win
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(meta).toContain("script-src 'self'");
  } finally {
    await app.close();
  }
});
