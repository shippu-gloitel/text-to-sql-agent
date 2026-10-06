import { describe, expect, test } from 'bun:test';
import { modelProfileSchema } from './types';

const profile = {
  provider: 'openai' as const,
  model: 'test-model',
  apiKey: 'test-key',
  temperature: 0,
};

describe('modelProfileSchema', () => {
  test('accepts an empty base URL to use the provider default', () => {
    expect(modelProfileSchema.safeParse({ ...profile, baseUrl: '' }).success).toBe(true);
  });

  test('reports required model fields clearly', () => {
    const result = modelProfileSchema.safeParse({ ...profile, model: '', apiKey: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message)).toEqual([
        'Model name is required.',
        'API key is required.',
      ]);
    }
  });

  test('accepts HTTP(S) custom model endpoints', () => {
    expect(
      modelProfileSchema.safeParse({ ...profile, baseUrl: 'http://localhost:11434/v1' }).success,
    ).toBe(true);
  });

  test.each(['file:///tmp/socket', 'ftp://models.example.com/v1', 'https://user:pass@host/v1'])(
    'rejects unsafe custom endpoint %s',
    baseUrl => {
      expect(() => modelProfileSchema.safeParse({ ...profile, baseUrl })).not.toThrow();
      expect(modelProfileSchema.safeParse({ ...profile, baseUrl }).success).toBe(false);
    },
  );
});
