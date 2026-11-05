import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/base.css';
import { App } from './app/App';
import { CaptureApp } from './capture/CaptureApp';
import { applyTheme } from './theme/applyTheme';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Colors before the first paint (the saved theme replaces this as soon as prefs load).
applyTheme('system');

createRoot(root).render(
  <StrictMode>{location.hash === '#capture' ? <CaptureApp /> : <App />}</StrictMode>,
);
