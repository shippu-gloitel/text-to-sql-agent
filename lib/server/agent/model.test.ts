import { afterEach, describe, expect, test } from 'bun:test';
import type { ModelProfile } from '../../types';
import { testModel } from './index';

const originalFetch = globalThis.fetch;
const originalAllowedModelHosts = process.env.ALLOWED_MODEL_HOSTS;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAllowedModelHosts === undefined) delete process.env.ALLOWED_MODEL_HOSTS;
  else process.env.ALLOWED_MODEL_HOSTS = originalAllowedModelHosts;
});

describe('model capability check', () => {
  test('uses the same structured tool call as SQL planning without OpenAI-only strict mode', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: 'capability-test',
        object: 'chat.completion',
        created: 0,
        model: 'compatible-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'text_to_sql_draft',
                    arguments: JSON.stringify({
                      isDatabaseQuestion: false,
                      sql: '',
                      explanation: 'Capability check passed.',
                      assumptions: [],
                    }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };

    const profile: ModelProfile = {
      provider: 'openai',
      model: 'compatible-model',
      apiKey: 'test-key',
      baseUrl: 'https://model.example/v1',
      temperature: 0,
    };
    await expect(testModel(profile)).resolves.toMatchObject({ ok: true });

    const tools = requestBody?.tools as Array<{ function?: { strict?: boolean; name?: string } }>;
    expect(tools[0]?.function?.name).toBe('text_to_sql_draft');
    expect(tools[0]?.function?.strict).toBeUndefined();
  });

  test('rejects custom model endpoints outside the server allowlist', async () => {
    process.env.ALLOWED_MODEL_HOSTS = 'allowed.example';
    await expect(
      testModel({
        provider: 'openai',
        model: 'compatible-model',
        apiKey: 'test-key',
        baseUrl: 'https://blocked.example/v1',
        temperature: 0,
      }),
    ).rejects.toThrow('not allowed');
  });
});
