'use client';

import type { SessionVaultEnvelope, VaultEnvelope } from './security/vault';

export const STORAGE_KEYS = {
  vault: 'tsql.v1.vault',
  settings: 'tsql.v1.settings',
  // Encrypted with the workspace data key (see `StoredProfiles.threadsKey`).
  threads: 'tsql.v3.threads',
} as const;

// Plaintext chat history from earlier versions; migrated into encrypted storage on unlock.
export const LEGACY_STORAGE_KEYS = {
  threadsV1: 'tsql.v1.threads',
  threadsV2: 'tsql.v2.threads',
} as const;

const SESSION_STORAGE_KEYS = {
  unlocked: 'tsql.v1.unlocked',
} as const;

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function readVault() {
  return readStorage<VaultEnvelope | null>(STORAGE_KEYS.vault, null);
}

export function readSessionVault() {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEYS.unlocked);
    return raw ? (JSON.parse(raw) as SessionVaultEnvelope) : null;
  } catch {
    return null;
  }
}

export function writeSessionVault(value: SessionVaultEnvelope) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEYS.unlocked, JSON.stringify(value));
  } catch {
    // Session storage may be disabled by the browser.
  }
}

export function clearSessionVault() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEYS.unlocked);
  } catch {
    // Session storage may be disabled by the browser.
  }
}

export function removeStorage(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Local storage may be disabled by the browser.
  }
}

export function clearAppStorage() {
  [...Object.values(STORAGE_KEYS), ...Object.values(LEGACY_STORAGE_KEYS)].forEach(removeStorage);
}
