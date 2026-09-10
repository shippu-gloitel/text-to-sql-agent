import { StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import {
  connectionProfileSchema,
  modelProfileSchema,
  type ConnectionProfile,
  type ModelProfile,
  type QueryResult,
} from '../../types';

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

export type AgentEmit = (event: Record<string, unknown>) => void;

export type Draft = {
  isDatabaseQuestion: boolean;
  sql: string;
  explanation: string;
  assumptions: string[];
};

export const AgentState = new StateSchema({
  question: z.string(),
  connection: connectionProfileSchema,
  model: modelProfileSchema,
  allowedObjects: z.array(z.string()),
  sql: z.string(),
  explanation: z.string(),
  tables: z.array(z.string()),
  checks: z.array(z.string()),
  decision: agentDecisionSchema.optional(),
  result: z.custom<QueryResult>().optional(),
});

export type AgentStateType = typeof AgentState.State;
