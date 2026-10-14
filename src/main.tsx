import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { currentAccount, setAccount } from './db/account';
import { db } from './db/schema';
import { migrateLegacySettings, seedIfEmpty } from './db/seed';
import { getSyncStatus, startSync, syncNow } from './db/sync';
import './index.css';

registerSW({ immediate: true });

// dev-only handle for debugging in the browser console
if (import.meta.env.DEV) (window as unknown as { db: typeof db }).db = db;

const root = createRoot(document.getElementById('root')!);

function Blocked({ message }: { message: string }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-muted">{message}</p>
      <button className="rounded-xl bg-accent px-5 py-3 font-medium text-accent-ink" onClick={() => location.reload()}>
        Try again
      </button>
    </div>
  );
}

async function boot() {
  await migrateLegacySettings();
  if (currentAccount() && !(await db.settings.get('settings'))) {
    // First open of this account on this device: pull its data before seeding anything,
    // so starter data can never overwrite what's already on the server.
    await syncNow();
    const s = getSyncStatus().state;
    if (s === 'off' || s === 'signed-out') {
      // no valid session for this account: back to this-device-only mode, sign in again from Settings
      setAccount(null);
      location.reload();
      return;
    }
    if (!(await db.settings.get('settings')) && s !== 'idle') {
      root.render(<Blocked message="Connect to the internet to finish signing in. Your account's data is downloaded the first time." />);
      return;
    }
  }
  await seedIfEmpty();
  // Ask the browser to keep IndexedDB even under storage pressure.
  navigator.storage?.persist?.().catch(() => undefined);
  startSync();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot();
