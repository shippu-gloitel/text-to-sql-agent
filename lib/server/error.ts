/** An error whose message is written for the end user and is safe to show in production. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function redact(message: string) {
  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(
      /((?:authorization|proxy-authorization):\s*(?:bearer|basic)\s+)[^\s,;]+/gi,
      '$1[redacted]',
    )
    .replace(/("(?:password|api[_-]?key|token)"\s*:\s*")[^"]*"/gi, '$1[redacted]"')
    .replace(/(password|api[_-]?key|token)=([^\s&]+)/gi, '$1=[redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1[redacted]@');
}

/** Writes unexpected errors to the server log (e.g. Vercel logs) with secrets masked. */
export function logServerError(context: string, error: unknown) {
  if (error instanceof UserFacingError) return;
  if (error instanceof Error && error.name === 'AbortError') return;
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  // Server logs (e.g. Vercel) are the only place these details are visible.
  // eslint-disable-next-line no-console
  console.error(`[${context}] ${redact(detail)}`);
}

function errorMetadata(error: unknown) {
  if (!error || typeof error !== 'object')
    return { name: '', message: String(error ?? ''), status: undefined };
  const candidate = error as { name?: unknown; message?: unknown; status?: unknown };
  const numericStatus = Number(candidate.status);
  return {
    name: typeof candidate.name === 'string' ? candidate.name : '',
    message: typeof candidate.message === 'string' ? candidate.message : '',
    status: Number.isFinite(numericStatus) ? numericStatus : undefined,
  };
}

const MODEL_STAGES = new Set(['Drafting SQL', 'Correcting SQL']);
const DATABASE_STAGES = new Set(['Reading schema', 'Reading table statistics']);

function safeModelError(detail: string, status?: number) {
  if (status === 401 || status === 403 || /authenticationerror|invalid[_ ]api[_ ]key/.test(detail))
    return 'The model rejected the API key or account access. Check the API key and provider permissions.';
  if (status === 404)
    return 'The model endpoint or model name was not found. Check the base URL and model name.';
  if (status === 429 || /ratelimiterror|rate limit|insufficient[_ ]quota/.test(detail))
    return 'The model provider rate limit or quota was reached. Wait briefly or check the provider account.';
  if (status === 400 && /tool|function.?call|structured|response.?format/.test(detail))
    return 'The selected model does not support the tool calling required to generate SQL. Choose a tool-capable model.';
  if (status === 400 && /context|token|too (?:large|long)|maximum (?:context|length)/.test(detail))
    return 'The database schema and conversation are too large for this model. Restrict the allowed tables or use a model with a larger context window.';
  if (status === 400)
    return 'The model rejected the SQL-planning request. Check the model name, base URL, and tool-calling support.';
  if (status !== undefined && status >= 500)
    return 'The model provider is temporarily unavailable. Try again shortly.';
  if (/zoderror|output.?parsing|tool_calls?.+invalid|no tool call/.test(detail))
    return 'The model returned an invalid structured response. Try again or choose a different tool-capable model.';
}

export function safeAgentError(error: unknown, stage?: string) {
  if (error instanceof UserFacingError) return redact(error.message);
  if (error instanceof Error && error.name === 'AbortError') return 'The request was cancelled.';

  const { name, message, status } = errorMetadata(error);
  const detail = `${name} ${message}`.toLowerCase();
  if (DATABASE_STAGES.has(stage ?? ''))
    return 'The database connection failed while reading its schema. Check the saved connection and the server network access.';
  const modelError = safeModelError(detail, status);
  if (modelError) return modelError;
  if (
    MODEL_STAGES.has(stage ?? '') &&
    /fetch failed|econn|enotfound|etimedout|network|socket|timeout/.test(detail)
  )
    return 'The server could not reach the model endpoint. Check the base URL and provider availability.';

  return process.env.NODE_ENV === 'development'
    ? `Agent error: ${redact(message)}`
    : 'The agent could not complete this request. Check the connection, model, or question.';
}
