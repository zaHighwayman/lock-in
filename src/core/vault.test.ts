import { describe, expect, it } from 'vitest';
import { deriveVaultKey, mergeKeys, openVault, sealVault } from './vault';

describe('vault crypto', () => {
  it('round-trips with the same password and user', async () => {
    const k1 = await deriveVaultKey('correct horse', 'user-1');
    const sealed = await sealVault({ gemini: 'AIza-test', groq: 'gsk_test' }, k1);
    expect(sealed.ct).not.toContain('AIza');
    const k2 = await deriveVaultKey('correct horse', 'user-1');
    expect(await openVault(sealed, k2)).toEqual({ gemini: 'AIza-test', groq: 'gsk_test' });
  });

  it('fails with a wrong password or another user', async () => {
    const sealed = await sealVault({ groq: 'gsk_test' }, await deriveVaultKey('pw-one-1', 'user-1'));
    await expect(openVault(sealed, await deriveVaultKey('pw-two-2', 'user-1'))).rejects.toThrow();
    await expect(openVault(sealed, await deriveVaultKey('pw-one-1', 'user-2'))).rejects.toThrow();
  });
});

describe('mergeKeys', () => {
  it('takes keys from the vault', () => {
    expect(mergeKeys({}, { groq: 'g' }, false)).toEqual({ apply: { groq: 'g' }, push: false });
  });
  it('keeps and pushes keys only this device has', () => {
    expect(mergeKeys({ gemini: 'a' }, { groq: 'g' }, false)).toEqual({ apply: { groq: 'g' }, push: true });
  });
  it('lets a fresh local edit win over an older vault', () => {
    expect(mergeKeys({ groq: 'new' }, { groq: 'old' }, true)).toEqual({ apply: {}, push: true });
  });
  it('a newer vault value replaces a stale local one', () => {
    expect(mergeKeys({ groq: 'old' }, { groq: 'new' }, false)).toEqual({ apply: { groq: 'new' }, push: false });
  });
  it('an empty field never wipes a synced key', () => {
    expect(mergeKeys({ groq: '' }, { groq: 'g' }, false)).toEqual({ apply: { groq: 'g' }, push: false });
  });
  it('nothing to do when in sync', () => {
    expect(mergeKeys({ groq: 'g' }, { groq: 'g' }, false)).toEqual({ apply: {}, push: false });
  });
});
