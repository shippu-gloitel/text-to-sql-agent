import { END, START, StateGraph, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import { validateSql } from '../../security/sql-policy';
import type { Dialect } from '../../types';
import type { Draft } from './state';
import { looksLikeDatabaseQuestion } from './utils';

export const MAX_REPAIR_ATTEMPTS = 2;

const State = new StateSchema({
  draft: z.object({
    isDatabaseQuestion: z.boolean(),
    sql: z.string(),
    explanation: z.string(),
    assumptions: z.array(z.string()),
  }),
  validation: z.object({
    valid: z.boolean(),
    sql: z.string(),
    tables: z.array(z.string()),
    checks: z.array(z.string()),
    errors: z.array(z.string()),
  }),
  repairs: z.number(),
});

export function createDraftGraph({
  question,
  dialect,
  allowed,
  generate,
  onRepair,
}: {
  question: string;
  dialect: Dialect;
  allowed: string[];
  generate: (rejected?: { sql: string; errors: string[] }) => Promise<Draft>;
  onRepair: () => void;
}) {
  return new StateGraph(State)
    .addNode('generate', async () => ({ draft: await generate() }))
    .addNode('check', state => ({
      validation: validateSql(state.draft.sql, dialect, allowed),
    }))
    .addNode('repairSql', async state => {
      onRepair();
      return {
        draft: await generate({ sql: state.draft.sql, errors: state.validation.errors }),
        repairs: state.repairs + 1,
      };
    })
    .addConditionalEdges(START, () => 'generate')
    .addConditionalEdges('generate', state =>
      state.draft.isDatabaseQuestion || looksLikeDatabaseQuestion(question) ? 'check' : END,
    )
    .addConditionalEdges('check', state => {
      if (state.validation.valid || !state.draft.sql.trim()) return END;
      return state.repairs < MAX_REPAIR_ATTEMPTS ? 'repairSql' : END;
    })
    .addEdge('repairSql', 'check')
    .compile();
}
