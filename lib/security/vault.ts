export type VaultEnvelope = {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type SessionVaultEnvelope = {
  version: 1;
  key: string;
  iv: string;
  ciphertext: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bufferSource(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bufferSource(salt), iterations: 210000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importSessionKey(raw: Uint8Array) {
  return crypto.subtle.importKey('raw', bufferSource(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptVault(value: unknown, passphrase: string): Promise<VaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    bufferSource(encoder.encode(JSON.stringify(value))),
  );
  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptVault<T>(envelope: VaultEnvelope, passphrase: string): Promise<T> {
  const key = await deriveKey(passphrase, base64ToBytes(envelope.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
    key,
    bufferSource(base64ToBytes(envelope.ciphertext)),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

// Session storage keeps only an encrypted cache and its random session key.
// It is cleared when the tab closes or the user locks/deletes the workspace.
export async function encryptSessionVault(value: unknown): Promise<SessionVaultEnvelope> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importSessionKey(rawKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    bufferSource(encoder.encode(JSON.stringify(value))),
  );
  return {
    version: 1,
    key: bytesToBase64(rawKey),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptSessionVault<T>(envelope: SessionVaultEnvelope): Promise<T> {
  const key = await importSessionKey(base64ToBytes(envelope.key));
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
    key,
    bufferSource(base64ToBytes(envelope.ciphertext)),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}
