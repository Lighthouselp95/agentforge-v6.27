import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './workbench.css';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initClientDiagnostics } from './utils/clientDiagnostics';

// Initialize global client error trapping for AI browser debugging
initClientDiagnostics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
