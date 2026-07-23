import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { WebcamOverlay } from './modules/overlay/WebcamOverlay.js';
import { ControlsOverlay } from './modules/overlay/ControlsOverlay.js';
import './index.css';

const queryClient = new QueryClient();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

// Some windows are lightweight overlays that reuse this bundle via `?overlay=…`
// (same secure origin, so camera permission and the preload bridge are available).
const overlay = new URLSearchParams(window.location.search).get('overlay');

function renderRoot(): ReactElement {
  if (overlay === 'webcam') return <WebcamOverlay />;
  if (overlay === 'controls') return <ControlsOverlay />;
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

createRoot(rootElement).render(<StrictMode>{renderRoot()}</StrictMode>);
