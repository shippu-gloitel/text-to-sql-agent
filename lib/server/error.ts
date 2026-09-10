export function safeAgentError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown agent error';
  const redacted = message
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/(password|api[_-]?key)=([^\s&]+)/gi, '$1=[redacted]');

  return process.env.NODE_ENV === 'development'
    ? `Agent error: ${redacted}`
    : 'The agent could not complete this request. Check the connection, model, or question.';
}
