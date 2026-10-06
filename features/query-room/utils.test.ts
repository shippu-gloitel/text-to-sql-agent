import { beforeEach, describe, expect, test } from 'bun:test';
import { generateDataKey } from '@/lib/security/vault';
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from '@/lib/storage';
import type { ChatThread } from './types';
import { escapeCsvCell, loadThreads, saveThreads } from './utils';

// Minimal localStorage with a size quota, like a browser's.
class QuotaStorage {
  items = new Map<string, string>();
  constructor(public quota = Infinity) {}
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    const size = [...this.items].reduce((sum, [k, v]) => (k === key ? sum : sum + v.length), 0);
    if (size + value.length > this.quota) throw new Error('QuotaExceededError');
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

let storage: QuotaStorage;
beforeEach(() => {
  storage = new QuotaStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
});

function thread(rows = 3): ChatThread {
  return {
    id: 'thread-1',
    title: 'Users',
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { id: 'u1', role: 'user', text: 'show users' },
      {
        id: 'a1',
        role: 'assistant',
        result: {
          columns: [{ name: 'email' }],
          rows: Array.from({ length: rows }, (_, index) => ({
            email: `person${index}@example.com`,
          })),
          rowCount: rows,
          truncated: false,
          durationMs: 1,
        },
      },
    ],
  };
}

describe('encrypted chat history', () => {
  test('saves encrypted and loads back', async () => {
    const key = generateDataKey();
    expect(await saveThreads([thread()], key)).toBe(true);
    const raw = storage.getItem(STORAGE_KEYS.threads) ?? '';
    expect(raw).not.toContain('example.com');
    expect(await loadThreads(key)).toEqual([thread()]);
  });

  test('returns no history for a different key', async () => {
    await saveThreads([thread()], generateDataKey());
    expect(await loadThreads(generateDataKey())).toEqual([]);
  });

  test('migrates plaintext history and removes it', async () => {
    const legacy = thread();
    legacy.messages.push({
      id: 'a2',
      role: 'assistant',
      approval: { sql: 'SELECT 1', explanation: '', tables: [], checks: [] } as never,
    });
    storage.setItem(LEGACY_STORAGE_KEYS.threadsV2, JSON.stringify([legacy]));
    const key = generateDataKey();

    const loaded = await loadThreads(key);
    expect(loaded[0].messages[1].result?.rows).toHaveLength(3);
    // Old approvals have no run id and cannot be resumed.
    expect(loaded[0].messages[2].approval).toBeUndefined();
    expect(loaded[0].messages[2].text).toContain('expired');
    expect(storage.getItem(LEGACY_STORAGE_KEYS.threadsV2)).toBeNull();
    expect(await loadThreads(key)).toEqual(loaded);
  });

  test('drops saved rows when storage is full instead of failing', async () => {
    const key = generateDataKey();
    storage.quota = 20_000;
    expect(await saveThreads([thread(5000)], key)).toBe(true);
    const saved = await loadThreads(key);
    const result = saved[0].messages[1].result;
    expect(result?.rows.length).toBeLessThan(5000);
    expect(result?.truncated).toBe(true);
    expect(result?.rowCount).toBe(5000);
  });

  test('does not write an encrypted snapshot after it becomes stale', async () => {
    const key = generateDataKey();
    let current = true;
    const saving = saveThreads([thread()], key, () => current);
    current = false;

    expect(await saving).toBe(false);
    expect(storage.getItem(STORAGE_KEYS.threads)).toBeNull();
  });
});

describe('CSV export safety', () => {
  test.each(['=2+2', '+cmd', '-cmd', '@SUM(A1:A2)', '  =2+2', '\t=2+2'])(
    'neutralizes spreadsheet formulas in %s',
    value => {
      expect(escapeCsvCell(value)).toBe(`"'${value}"`);
    },
  );

  test('does not change numeric values or ordinary text', () => {
    expect(escapeCsvCell(-2)).toBe('"-2"');
    expect(escapeCsvCell('hello "world"')).toBe('"hello ""world"""');
  });
});
