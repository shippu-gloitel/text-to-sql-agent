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
    .replace(/(password|api[_-]?key)=([^\s&]+)/gi, '$1=[redacted]');
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

export function safeAgentError(error: unknown) {
  if (error instanceof UserFacingError) return redact(error.message);
  if (error instanceof Error && error.name === 'AbortError') return 'The request was cancelled.';
  const message = error instanceof Error ? error.message : 'Unknown agent error';

  return process.env.NODE_ENV === 'development'
    ? `Agent error: ${redact(message)}`
    : 'The agent could not complete this request. Check the connection, model, or question.';
}
