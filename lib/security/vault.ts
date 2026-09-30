export type VaultEnvelope = {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  /** PBKDF2 iterations. Missing on vaults created before this field existed. */
  iterations?: number;
};

export type SessionVaultEnvelope = {
  version: 1;
  key: string;
  iv: string;
  ciphertext: string;
};

/** Data encrypted with a random key that is stored inside the passphrase vault. */
export type DataEnvelope = {
  version: 1;
  iv: string;
  ciphertext: string;
};

// OWASP's current recommendation for PBKDF2-HMAC-SHA256.
export const VAULT_ITERATIONS = 600_000;
const LEGACY_VAULT_ITERATIONS = 210_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bufferSource(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bufferSource(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importRawKey(raw: Uint8Array) {
  return crypto.subtle.importKey('raw', bufferSource(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptJson(value: unknown, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    bufferSource(encoder.encode(JSON.stringify(value))),
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

async function decryptJson<T>(iv: string, ciphertext: string, key: CryptoKey): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    bufferSource(base64ToBytes(ciphertext)),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export function vaultNeedsUpgrade(envelope: VaultEnvelope) {
  return (envelope.iterations ?? LEGACY_VAULT_ITERATIONS) < VAULT_ITERATIONS;
}

export async function encryptVault(value: unknown, passphrase: string): Promise<VaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, VAULT_ITERATIONS);
  return {
    version: 1,
    salt: bytesToBase64(salt),
    iterations: VAULT_ITERATIONS,
    ...(await encryptJson(value, key)),
  };
}

export async function decryptVault<T>(envelope: VaultEnvelope, passphrase: string): Promise<T> {
  const key = await deriveKey(
    passphrase,
    base64ToBytes(envelope.salt),
    envelope.iterations ?? LEGACY_VAULT_ITERATIONS,
  );
  return decryptJson<T>(envelope.iv, envelope.ciphertext, key);
}

// Session storage keeps only an encrypted cache and its random session key.
// It is cleared when the tab closes or the user locks/deletes the workspace.
export async function encryptSessionVault(value: unknown): Promise<SessionVaultEnvelope> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  return {
    version: 1,
    key: bytesToBase64(rawKey),
    ...(await encryptJson(value, await importRawKey(rawKey))),
  };
}

export async function decryptSessionVault<T>(envelope: SessionVaultEnvelope): Promise<T> {
  return decryptJson<T>(
    envelope.iv,
    envelope.ciphertext,
    await importRawKey(base64ToBytes(envelope.key)),
  );
}

/** Creates a random base64 key for encrypting workspace data such as chat history. */
export function generateDataKey() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export async function encryptWithDataKey(value: unknown, dataKey: string): Promise<DataEnvelope> {
  return { version: 1, ...(await encryptJson(value, await importRawKey(base64ToBytes(dataKey)))) };
}

export async function decryptWithDataKey<T>(envelope: DataEnvelope, dataKey: string): Promise<T> {
  return decryptJson<T>(
    envelope.iv,
    envelope.ciphertext,
    await importRawKey(base64ToBytes(dataKey)),
  );
}
