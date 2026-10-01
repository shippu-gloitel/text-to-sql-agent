import Database from 'better-sqlite3';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Pending approvals are stored in a local SQLite file so they survive server restarts. The graph
// state holds only the question, SQL and table names: connection details and query results are
// never written here (see run-context.ts).
const DB_PATH = path.join(process.cwd(), '.data', 'approvals.sqlite');
const APPROVAL_TTL_MS = 30 * 60_000;

let store: { db: Database.Database; checkpointer: SqliteSaver } | undefined;

function getStore() {
  if (store) return store;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  // Overwrite deleted approvals instead of leaving their contents in free pages.
  db.pragma('secure_delete = ON');
  db.exec(
    'CREATE TABLE IF NOT EXISTS approval_expiry (thread_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)',
  );
  store = { db, checkpointer: new SqliteSaver(db) };
  return store;
}

export function getCheckpointer() {
  return getStore().checkpointer;
}

export async function touchCheckpoint(checkpointId: string) {
  getStore()
    .db.prepare(
      'INSERT INTO approval_expiry (thread_id, expires_at) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET expires_at = excluded.expires_at',
    )
    .run(checkpointId, Date.now() + APPROVAL_TTL_MS);
  await sweepExpiredCheckpoints();
}

export async function forgetCheckpoint(checkpointId: string) {
  const { db, checkpointer } = getStore();
  await checkpointer.deleteThread(checkpointId);
  db.prepare('DELETE FROM approval_expiry WHERE thread_id = ?').run(checkpointId);
}

/** Removes approvals that were never acted on, including ones left over from earlier runs. */
export async function sweepExpiredCheckpoints() {
  const expired = getStore()
    .db.prepare('SELECT thread_id FROM approval_expiry WHERE expires_at < ?')
    .all(Date.now()) as Array<{ thread_id: string }>;
  for (const { thread_id: checkpointId } of expired) await forgetCheckpoint(checkpointId);
}
