// Background sync with the Cloudflare Worker (optional). Last-write-wins on updatedAt;
// the server hands out a monotonic cursor so device clock skew can't skip records.
import { db, SYNCED_TABLES, type SyncedTable } from './schema';
import { getMeta, onLocalChange, setMeta } from './repo';
import { currentAccount } from './account';

interface SyncRecord {
  table: SyncedTable;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: unknown;
}

export type SyncStatus = { state: 'off' | 'idle' | 'syncing' | 'error' | 'signed-out'; message?: string; at?: number };
let status: SyncStatus = { state: 'off' };
const listeners = new Set<(s: SyncStatus) => void>();
function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l(s));
}
export const getSyncStatus = () => status;
export function subscribeSync(fn: (s: SyncStatus) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function config() {
  const account = currentAccount();
  const token = await getMeta<string>('auth:token', '');
  return account && token ? { url: account.server.replace(/\/$/, ''), token } : null;
}

class SignedOut extends Error {}

async function check(res: Response, what: string) {
  if (res.status === 401) throw new SignedOut();
  if (!res.ok) throw new Error(`${what} ${res.status}`);
  return res;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = (name: SyncedTable) => (db as any)[name] as import('dexie').Table<any, string>;

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (!running) running = doSync().finally(() => (running = null));
  return running;
}

async function doSync() {
  const cfg = await config();
  if (!cfg) return setStatus({ state: 'off' });
  if (!navigator.onLine) return setStatus({ state: 'idle', message: 'Offline: will sync when back online', at: status.at });
  setStatus({ state: 'syncing', at: status.at });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` };
  try {
    // push
    const lastPush = await getMeta<number>('sync:lastPush', 0);
    const out: SyncRecord[] = [];
    let maxSeen = lastPush;
    for (const t of SYNCED_TABLES) {
      const rows = await tbl(t).where('updatedAt').above(lastPush).toArray();
      for (const r of rows) {
        out.push({ table: t, id: r.id, updatedAt: r.updatedAt, deleted: false, data: r });
        maxSeen = Math.max(maxSeen, r.updatedAt);
      }
    }
    for (const ts of await db.tombstones.where('updatedAt').above(lastPush).toArray()) {
      out.push({ table: ts.table, id: ts.recordId, updatedAt: ts.updatedAt, deleted: true, data: null });
      maxSeen = Math.max(maxSeen, ts.updatedAt);
    }
    for (let i = 0; i < out.length; i += 400) {
      await check(await fetch(`${cfg.url}/sync/push`, { method: 'POST', headers, body: JSON.stringify({ records: out.slice(i, i + 400) }) }), 'push');
    }
    await setMeta('sync:lastPush', maxSeen);

    // pull
    let cursor = await getMeta<number>('sync:cursor', 0);
    for (let page = 0; page < 50; page++) {
      const res = await check(await fetch(`${cfg.url}/sync/pull?since=${cursor}`, { headers }), 'pull');
      const body = (await res.json()) as { records: SyncRecord[]; cursor: number; more: boolean };
      await applyRemote(body.records);
      cursor = body.cursor;
      await setMeta('sync:cursor', cursor);
      if (!body.more) break;
    }
    setStatus({ state: 'idle', at: Date.now() });
  } catch (e) {
    if (e instanceof SignedOut) setStatus({ state: 'signed-out', message: 'Session expired. Sign in again to keep syncing.', at: status.at });
    else setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e), at: status.at });
  }
}

async function applyRemote(records: SyncRecord[]) {
  for (const r of records) {
    if (!SYNCED_TABLES.includes(r.table)) continue;
    const t = tbl(r.table);
    const local = await t.get(r.id);
    if (local && local.updatedAt > r.updatedAt) continue;
    if (r.deleted) await t.delete(r.id);
    else await t.put(r.data);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function startSync() {
  onLocalChange(() => {
    clearTimeout(timer);
    timer = setTimeout(syncNow, 4000);
  });
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  syncNow();
}

/** Calls an authenticated Worker endpoint (integrations). */
export async function workerFetch(path: string, init: RequestInit = {}) {
  const cfg = await config();
  if (!cfg) throw new Error('Sign in to an account first (Settings → Account).');
  const res = await fetch(`${cfg.url}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
  return body;
}
