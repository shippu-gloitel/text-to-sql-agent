import type { ConnectionProfile, HistoryTurn, ModelProfile, StreamEvent } from '../../types';

export type AgentInput = {
  question: string;
  connection: ConnectionProfile;
  model: ModelProfile;
  threadId: string;
  history: HistoryTurn[];
};

/**
 * A decision on an approval card. The browser holds the pending SQL and sends it back, so the
 * server keeps no state between requests (required on serverless hosts such as Vercel).
 */
export type ResumeInput = {
  runId: string;
  decision: 'approve' | 'reject' | 'edit';
  sql?: string;
  explanation?: string;
  connection: ConnectionProfile;
};

export type AgentEmit = (event: StreamEvent) => void;

export type Draft = {
  isDatabaseQuestion: boolean;
  sql: string;
  explanation: string;
  assumptions: string[];
};
