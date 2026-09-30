import { MemorySaver } from '@langchain/langgraph';

// In-memory approval checkpoints are scoped to this server process. Each checkpoint holds the
// connection profile (including credentials), so finished runs are removed right away and
// abandoned approvals expire.
export const checkpointer = new MemorySaver();

const APPROVAL_TTL_MS = 30 * 60_000;
const lastTouched = new Map<string, number>();

export function touchCheckpoint(checkpointId: string) {
  lastTouched.set(checkpointId, Date.now());
  void sweepExpiredCheckpoints();
}

export async function forgetCheckpoint(checkpointId: string) {
  lastTouched.delete(checkpointId);
  await checkpointer.deleteThread(checkpointId);
}

async function sweepExpiredCheckpoints() {
  const cutoff = Date.now() - APPROVAL_TTL_MS;
  const expired = [...lastTouched].filter(([, touchedAt]) => touchedAt < cutoff);
  await Promise.all(expired.map(([checkpointId]) => forgetCheckpoint(checkpointId)));
}
