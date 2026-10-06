import { describe, expect, test } from 'bun:test';
import type { Draft } from './state';
import { createDraftGraph, MAX_REPAIR_ATTEMPTS } from './workflow';

const draft = (sql: string, isDatabaseQuestion = true): Draft => ({
  isDatabaseQuestion,
  sql,
  explanation: '',
  assumptions: [],
});

const initialState = {
  draft: draft(''),
  validation: { valid: false, sql: '', tables: [], checks: [], errors: [] },
  repairs: 0,
};

describe('LangGraph SQL drafting workflow', () => {
  test('validates and repairs a rejected draft before approval', async () => {
    const generations = [draft('DELETE FROM users'), draft('SELECT id FROM users')];
    let repairs = 0;
    const graph = createDraftGraph({
      question: 'Show user IDs',
      dialect: 'sqlite',
      allowed: ['users'],
      generate: async () => generations.shift()!,
      onRepair: () => repairs++,
    });

    const result = await graph.invoke(initialState);

    expect(result.draft.sql).toBe('SELECT id FROM users');
    expect(result.validation.valid).toBe(true);
    expect(result.repairs).toBe(1);
    expect(repairs).toBe(1);
  });

  test('stops after the configured number of repairs', async () => {
    let generations = 0;
    const graph = createDraftGraph({
      question: 'Show user IDs',
      dialect: 'sqlite',
      allowed: ['users'],
      generate: async () => {
        generations++;
        return draft('DELETE FROM users');
      },
      onRepair: () => {},
    });

    const result = await graph.invoke(initialState);

    expect(MAX_REPAIR_ATTEMPTS).toBe(2);
    expect(generations).toBe(MAX_REPAIR_ATTEMPTS + 1);
    expect(result.repairs).toBe(MAX_REPAIR_ATTEMPTS);
    expect(result.validation.valid).toBe(false);
  });

  test('skips SQL validation for an off-topic question', async () => {
    let generations = 0;
    const graph = createDraftGraph({
      question: 'Tell me a joke',
      dialect: 'sqlite',
      allowed: ['users'],
      generate: async () => {
        generations++;
        return draft('', false);
      },
      onRepair: () => {},
    });

    const result = await graph.invoke(initialState);

    expect(generations).toBe(1);
    expect(result.validation.errors).toEqual([]);
    expect(result.repairs).toBe(0);
  });
});
