// Device side of encrypted API-key sync. Keys live in this device's meta table as before;
// a sealed copy rides along in the synced settings record.
import { deriveVaultKey, mergeKeys, openVault, sealVault, VAULT_KEY_NAMES, type VaultKeys } from '../core/vault';
import { currentAccount } from '../db/account';
import { getMeta, patch, setMeta } from '../db/repo';
import { db } from '../db/schema';

export type VaultStatus = 'off' | 'needs-password' | 'wrong-password' | 'ok';

async function localKeys(): Promise<VaultKeys> {
  const out: VaultKeys = {};
  for (const k of VAULT_KEY_NAMES) out[k] = await getMeta<string>(`key:${k}`, '');
  return out;
}

async function push(raw: string) {
  const keys = await localKeys();
  const filled = Object.fromEntries(Object.entries(keys).filter(([, v]) => v)) as VaultKeys;
  await patch('settings', 'settings', { vault: await sealVault(filled, raw) });
  await setMeta('vault:dirty', false);
}

/** Bring this device's keys and the synced vault together. Safe to call any time. */
export async function reconcileVault(): Promise<VaultStatus> {
  if (!currentAccount()) return 'off';
  const raw = await getMeta<string>('vault:key', '');
  if (!raw) return 'needs-password';
  const sealed = (await db.settings.get('settings'))?.vault;
  let remote: VaultKeys = {};
  if (sealed) {
    try {
      remote = await openVault(sealed, raw);
    } catch {
      return 'wrong-password';
    }
  }
  const dirty = await getMeta<boolean>('vault:dirty', false);
  const { apply, push: needsPush } = mergeKeys(await localKeys(), remote, dirty);
  for (const [k, v] of Object.entries(apply)) await setMeta(`key:${k}`, v);
  if (needsPush) await push(raw);
  else if (dirty) await setMeta('vault:dirty', false);
  return 'ok';
}

/** Store the vault key derived from the password (at sign-in, or entered later in Settings). */
export async function unlockVault(password: string): Promise<VaultStatus> {
  const account = currentAccount();
  if (!account) return 'off';
  const raw = await deriveVaultKey(password, account.userId);
  const sealed = (await db.settings.get('settings'))?.vault;
  if (sealed) {
    try {
      await openVault(sealed, raw);
    } catch {
      return 'wrong-password';
    }
  }
  await setMeta('vault:key', raw);
  return reconcileVault();
}

/** After a password change: same keys, new encryption key. */
export async function rekeyVault(newPassword: string) {
  const account = currentAccount();
  if (!account) return;
  const raw = await deriveVaultKey(newPassword, account.userId);
  await setMeta('vault:key', raw);
  await push(raw);
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** A key was edited on this device: it wins, and goes up shortly. */
export async function keyEdited() {
  await setMeta('vault:dirty', true);
  clearTimeout(timer);
  timer = setTimeout(() => void reconcileVault(), 1000);
}
