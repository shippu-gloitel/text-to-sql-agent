/** An error whose message is written for the end user and is safe to show in production. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

function redact(message: string) {
  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/(password|api[_-]?key)=([^\s&]+)/gi, '$1=[redacted]');
}

export function safeAgentError(error: unknown) {
  if (error instanceof UserFacingError) return redact(error.message);
  if (error instanceof Error && error.name === 'AbortError') return 'The request was cancelled.';
  const message = error instanceof Error ? error.message : 'Unknown agent error';

  return process.env.NODE_ENV === 'development'
    ? `Agent error: ${redact(message)}`
    : 'The agent could not complete this request. Check the connection, model, or question.';
}
