import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@/styles/tokens.css';
import { App } from '@/App';
import { installDiagnostics } from '@/lib/diagnostics';

// Before anything renders: errors from here on are counted (never stored as text).
installDiagnostics();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
