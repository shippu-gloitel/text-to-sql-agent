import type { ConnectionProfile, QueryResult } from '../../types';

/**
 * Values a graph run needs but that must never be written to the approval store: the connection
 * profile (credentials) and the query result (your data). They live in memory only while the
 * request that supplied them is running.
 */
type RunContext = { connection: ConnectionProfile; result?: QueryResult };

const contexts = new Map<string, RunContext>();

export async function withRunContext<T>(
  checkpoint: string,
  connection: ConnectionProfile,
  run: (context: RunContext) => Promise<T>,
) {
  const context: RunContext = { connection };
  contexts.set(checkpoint, context);
  try {
    return await run(context);
  } finally {
    contexts.delete(checkpoint);
  }
}

export function getRunContext(config: { configurable?: Record<string, unknown> }) {
  const checkpoint = config.configurable?.thread_id;
  const context = typeof checkpoint === 'string' ? contexts.get(checkpoint) : undefined;
  if (!context) throw new Error('The approval run has no active connection.');
  return context;
}
