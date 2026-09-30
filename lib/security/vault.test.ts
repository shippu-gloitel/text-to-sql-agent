import { describe, expect, test } from 'bun:test';
import {
  VAULT_ITERATIONS,
  decryptSessionVault,
  decryptVault,
  decryptWithDataKey,
  encryptSessionVault,
  encryptVault,
  encryptWithDataKey,
  generateDataKey,
  vaultNeedsUpgrade,
} from './vault';

describe('vault', () => {
  test('round-trips through a passphrase vault', async () => {
    const envelope = await encryptVault({ secret: 'value' }, 'correct horse');
    expect(envelope.iterations).toBe(VAULT_ITERATIONS);
    expect(vaultNeedsUpgrade(envelope)).toBe(false);
    expect(await decryptVault(envelope, 'correct horse')).toEqual({ secret: 'value' });
    await expect(decryptVault(envelope, 'wrong')).rejects.toThrow();
  });

  test('flags vaults created before iterations were stored for upgrade', async () => {
    const envelope = await encryptVault({}, 'pass');
    const legacy = { ...envelope, iterations: undefined };
    expect(vaultNeedsUpgrade(legacy)).toBe(true);
  });

  test('round-trips session and data-key envelopes', async () => {
    expect(await decryptSessionVault(await encryptSessionVault([1, 2]))).toEqual([1, 2]);

    const key = generateDataKey();
    const large = {
      rows: Array.from({ length: 5000 }, (_, index) => ({ index, text: 'x'.repeat(40) })),
    };
    const envelope = await encryptWithDataKey(large, key);
    expect(envelope.ciphertext).not.toContain('xxxx');
    expect(await decryptWithDataKey(envelope, key)).toEqual(large);
    await expect(decryptWithDataKey(envelope, generateDataKey())).rejects.toThrow();
  });
});
