import { StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import type { ConnectionProfile, ModelProfile, StreamEvent } from '../../types';

const agentDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'edit']),
  sql: z.string().optional(),
});

export type AgentDecision = z.infer<typeof agentDecisionSchema>;

export type AgentInput = {
  question: string;
  connection: ConnectionProfile;
  model: ModelProfile;
  threadId: string;
};

export type AgentEmit = (event: StreamEvent) => void;

export type Draft = {
  isDatabaseQuestion: boolean;
  sql: string;
  explanation: string;
  assumptions: string[];
};

// Everything here is saved to the approval store, so it must never contain credentials or query
// results. The connection and result are passed through run-context.ts instead.
export const AgentState = new StateSchema({
  question: z.string(),
  allowedObjects: z.array(z.string()),
  sql: z.string(),
  explanation: z.string(),
  tables: z.array(z.string()),
  checks: z.array(z.string()),
  // Problems found in SQL the user edited; the approval step shows them and blocks execution.
  validationErrors: z.array(z.string()).optional(),
  decision: agentDecisionSchema.optional(),
});
