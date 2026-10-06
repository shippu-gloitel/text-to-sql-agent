import { describe, expect, test } from 'bun:test';
import { safeAgentError, UserFacingError } from './error';

function httpError(status: number, message: string, name = 'APIError') {
  return Object.assign(new Error(message), { name, status });
}

describe('safeAgentError', () => {
  test('turns model authentication and quota failures into actionable messages', () => {
    expect(
      safeAgentError(
        httpError(401, 'Incorrect API key provided: sk-secret', 'AuthenticationError'),
      ),
    ).toContain('rejected the API key');
    expect(safeAgentError(httpError(429, 'Rate limit reached', 'RateLimitError'))).toContain(
      'rate limit or quota',
    );
  });

  test('distinguishes unsupported tools and oversized context', () => {
    expect(safeAgentError(httpError(400, 'This model does not support tools'))).toContain(
      'does not support the tool calling',
    );
    expect(safeAgentError(httpError(400, 'maximum context length exceeded'))).toContain(
      'schema and conversation are too large',
    );
  });

  test('uses the active stage for database and model network failures', () => {
    expect(safeAgentError(new Error('connect ECONNREFUSED'), 'Reading schema')).toContain(
      'database connection failed',
    );
    expect(safeAgentError(new Error('fetch failed'), 'Drafting SQL')).toContain(
      'could not reach the model endpoint',
    );
    expect(safeAgentError(httpError(404, 'not found'), 'Reading schema')).toContain(
      'database connection failed',
    );
  });

  test('redacts structured secrets, authorization headers, and database URLs', () => {
    const error = new UserFacingError(
      '"apiKey":"secret" Authorization: Basic dXNlcjpwYXNz postgresql://user:pass@db/test',
    );
    const message = safeAgentError(error);
    expect(message).not.toContain('secret');
    expect(message).not.toContain('dXNlcjpwYXNz');
    expect(message).not.toContain(':pass@');
  });

  test('keeps explicit user-facing errors while masking secrets', () => {
    expect(safeAgentError(new UserFacingError('Rejected api_key=secret-value'))).toBe(
      'Rejected api_key=[redacted]',
    );
  });
});
