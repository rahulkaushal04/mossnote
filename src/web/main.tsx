import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app/App';

// Radix's scroll lock injects a <style> element. Its injector reads this global for a nonce so the
// element satisfies `style-src 'nonce-…'`. Without a real nonce (development) nothing is set.
const nonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content');
if (nonce && nonce !== '__CSP_NONCE__') window.__webpack_nonce__ = nonce;

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');
const root = createRoot(container);

/**
 * In the standalone web app the journal runs in a worker that must start first. Where it cannot
 * (an old browser, another tab holds the files) a page says why instead of the app. The server
 * build never loads any of this: the flag is a constant and the branch is removed from the bundle.
 */
async function render(): Promise<void> {
  if (__MOSS_STANDALONE__) {
    const { startStandalone } = await import('./standalone/boot');
    const start = await startStandalone();
    if (!start.ok) {
      const { StartupScreen } = await import('./standalone/StartupScreen');
      root.render(<StartupScreen problem={start.problem} message={start.message} />);
      return;
    }
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void render();
