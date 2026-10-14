// Which account this device is signed in to. Device-level, so it lives in localStorage
// (it decides which IndexedDB database to open, before any database is open).
// The session token itself is stored inside that account's own database.

export interface Account {
  userId: string;
  username: string;
  isAdmin: boolean;
  server: string;
}

const KEY = 'lockin:account';
const SERVER_KEY = 'lockin:server';

/** Build-time default server (set SERVER_URL as a GitHub repo variable). */
export const DEFAULT_SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export function currentAccount(): Account | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

export function setAccount(a: Account | null) {
  try {
    if (a) {
      localStorage.setItem(KEY, JSON.stringify(a));
      localStorage.setItem(SERVER_KEY, a.server);
    } else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the app falls back to this-device-only mode */
  }
}

export function lastServer(): string {
  try {
    return localStorage.getItem(SERVER_KEY) || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

/** "lock-in" is the this-device-only database; each account gets its own. */
export function dbNameFor(a: Account | null): string {
  return a ? `lock-in-u-${a.userId}` : 'lock-in';
}
