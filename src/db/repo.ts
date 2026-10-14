// All app writes go through save/remove so updatedAt and deletion tombstones stay right for sync.
import { db, type SyncedTable, type TableTypes } from './schema';

export function uid(): string {
  // time-sortable id: 10 chars of ms timestamp + 10 random
  const t = Date.now().toString(36).padStart(10, '0');
  const r = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('');
  return t + r;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: SyncedTable) => (db as any)[name] as import('dexie').Table<any, string>;

type Input<K extends SyncedTable> = Omit<TableTypes[K], 'updatedAt'> & { updatedAt?: number };

export async function save<K extends SyncedTable>(name: K, row: Input<K>): Promise<TableTypes[K]> {
  const full = { ...row, updatedAt: Date.now() } as TableTypes[K];
  await table(name).put(full);
  scheduleSync();
  return full;
}

export async function saveMany<K extends SyncedTable>(name: K, rows: Input<K>[]) {
  const now = Date.now();
  await table(name).bulkPut(rows.map((r) => ({ ...r, updatedAt: now })));
  scheduleSync();
}

export async function patch<K extends SyncedTable>(name: K, id: string, changes: Partial<TableTypes[K]>) {
  await table(name).update(id, { ...changes, updatedAt: Date.now() });
  scheduleSync();
}

export async function remove(name: SyncedTable, ids: string | string[]) {
  const list = Array.isArray(ids) ? ids : [ids];
  if (list.length === 0) return;
  const now = Date.now();
  await db.transaction('rw', [table(name), db.tombstones], async () => {
    await table(name).bulkDelete(list);
    await db.tombstones.bulkPut(list.map((id) => ({ id: `${name}:${id}`, table: name, recordId: id, updatedAt: now })));
  });
  scheduleSync();
}

// Sync is wired in lazily to avoid an import cycle.
let syncHook: (() => void) | null = null;
export function onLocalChange(fn: () => void) {
  syncHook = fn;
}
function scheduleSync() {
  syncHook?.();
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}
