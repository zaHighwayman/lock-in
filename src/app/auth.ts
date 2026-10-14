// Sign in / create account / sign out. Each account gets its own IndexedDB database on the device;
// switching accounts reloads the app so every screen reads the right one.
import { currentAccount, dbNameFor, setAccount, type Account } from '../db/account';
import { getMeta, setMeta } from '../db/repo';
import { db, LockInDB, SYNCED_TABLES } from '../db/schema';
import { workerFetch } from '../db/sync';

interface AuthResult {
  token: string;
  user: { id: string; username: string; isAdmin: boolean };
}

async function call<T>(server: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the server. Check the address and your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
  return data as T;
}

export function serverStatus(server: string) {
  return call<{ needsSetup: boolean }>(server, '/auth/status');
}

/** Does this device's current database hold anything the person logged? */
export async function hasLocalData(): Promise<boolean> {
  const counts = await Promise.all([db.sessions.count(), db.runs.count(), db.body.count(), db.foodLog.count(), db.sleep.count()]);
  return counts.some((n) => n > 0);
}

export async function signIn(server: string, username: string, password: string, copyLocal: boolean) {
  const r = await call<AuthResult>(server, '/auth/login', { username, password });
  await enter(server, r, copyLocal);
}

export async function register(server: string, username: string, password: string, invite: string, copyLocal: boolean) {
  const r = await call<AuthResult>(server, '/auth/register', { username, password, invite });
  await enter(server, r, copyLocal);
}

const LOCAL_ONLY_META = /^(auth:|sync:)/;

/** Reload into the app's start screen (the database binding changes with the account). */
function restart() {
  history.replaceState(null, '', `${location.pathname}#/`);
  location.reload();
}

async function enter(server: string, r: AuthResult, copyLocal: boolean) {
  const account: Account = { userId: r.user.id, username: r.user.username, isAdmin: r.user.isAdmin, server: server.replace(/\/$/, '') };
  const target = new LockInDB(dbNameFor(account));
  await target.open();
  if (copyLocal && target.name !== db.name) {
    // keep original updatedAt so the newest version still wins when it syncs
    for (const t of SYNCED_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (db as any)[t].toArray();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (rows.length) await (target as any)[t].bulkPut(rows);
    }
    await target.photos.bulkPut(await db.photos.toArray());
    await target.meta.bulkPut((await db.meta.toArray()).filter((m) => !LOCAL_ONLY_META.test(m.key)));
  }
  await target.meta.put({ key: 'auth:token', value: r.token });
  target.close();
  setAccount(account);
  if (copyLocal && db.name === dbNameFor(null)) {
    // moved, not copied: signing out later must not leave this data in the shared device-only space
    db.close();
    await LockInDB.delete(db.name);
  }
  restart();
}

/** Sign out. With removeData, this account's copy on this device is deleted (it stays on the server). */
export async function signOut(removeData: boolean) {
  const account = currentAccount();
  if (account) {
    const token = await getMeta<string>('auth:token', '');
    if (token) {
      await fetch(`${account.server}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    }
    await setMeta('auth:token', '');
  }
  setAccount(null);
  if (removeData) {
    db.close();
    await LockInDB.delete(db.name);
  }
  restart();
}

export function changePassword(oldPassword: string, newPassword: string) {
  return workerFetch('/auth/password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) });
}

export async function deleteAccount(password: string) {
  await workerFetch('/auth/delete', { method: 'POST', body: JSON.stringify({ password }) });
  setAccount(null);
  db.close();
  await LockInDB.delete(db.name);
  restart();
}

export interface AdminOverview {
  users: { username: string; isAdmin: boolean; createdAt: number; lastSeen: number | null; records: number }[];
  invites: { code: string; createdAt: number; expiresAt: number; usedBy: string | null; usedAt: number | null }[];
}

export const adminOverview = () => workerFetch('/admin/overview') as Promise<AdminOverview>;
export const createInvite = () => workerFetch('/admin/invites', { method: 'POST' }) as Promise<{ code: string; expiresAt: number }>;
