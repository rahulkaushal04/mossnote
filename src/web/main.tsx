import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app/App';

// Radix's scroll lock injects a <style> element. Its injector reads this global for a nonce so the
// element satisfies `style-src 'nonce-…'`. Without a real nonce (development) nothing is set.
const nonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content');
if (nonce && nonce !== '__CSP_NONCE__') window.__webpack_nonce__ = nonce;

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
