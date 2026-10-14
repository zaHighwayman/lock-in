import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { db } from './db/schema';
import { seedIfEmpty } from './db/seed';
import { startSync } from './db/sync';
import './index.css';

registerSW({ immediate: true });

// dev-only handle for debugging in the browser console
if (import.meta.env.DEV) (window as unknown as { db: typeof db }).db = db;

async function boot() {
  await seedIfEmpty();
  // Ask the browser to keep IndexedDB even under storage pressure.
  navigator.storage?.persist?.().catch(() => undefined);
  startSync();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot();
