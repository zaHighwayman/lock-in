// End-to-end encrypted API-key sync. The vault key is derived on the device from the account
// password (PBKDF2), so the server only ever stores ciphertext it cannot read.

export const VAULT_KEY_NAMES = ['gemini', 'groq', 'openai', 'anthropic'] as const;
export type VaultKeys = Partial<Record<(typeof VAULT_KEY_NAMES)[number], string>>;

export interface SealedVault {
  v: 1;
  iv: string;
  ct: string;
}

const ITERATIONS = 300_000;
const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Raw AES key (base64) from the account password. Salted per user, so equal passwords give different keys. */
export async function deriveVaultKey(password: string, userId: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`lock-in-vault:${userId}`), iterations: ITERATIONS }, base, 256);
  return b64(bits);
}

const aes = (raw: string) => crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function sealVault(keys: VaultKeys, raw: string): Promise<SealedVault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(raw), enc.encode(JSON.stringify(keys)));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}

/** Throws if the key is wrong (AES-GCM authentication fails). */
export async function openVault(sealed: SealedVault, raw: string): Promise<VaultKeys> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, await aes(raw), unb64(sealed.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as VaultKeys;
}

/**
 * Decide how to reconcile this device's keys with the synced vault.
 * - dirty (edited here, not yet pushed): this device wins.
 * - otherwise the vault wins for keys it has; keys only this device has are kept and pushed (union).
 * Clearing a key is not propagated, so an empty field on one device never wipes another's key.
 */
export function mergeKeys(local: VaultKeys, remote: VaultKeys, dirty: boolean): { apply: VaultKeys; push: boolean } {
  const apply: VaultKeys = {};
  let push = false;
  for (const k of VAULT_KEY_NAMES) {
    const l = local[k] || '';
    const r = remote[k] || '';
    if (dirty) {
      if (l && l !== r) push = true;
      continue;
    }
    if (r && r !== l) apply[k] = r;
    else if (l && !r) push = true;
  }
  return { apply, push };
}
