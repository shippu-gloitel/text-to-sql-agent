import { END, START, StateGraph, interrupt } from '@langchain/langgraph';
import { executeReadOnly } from '../db';
import { UserFacingError } from '../error';
import { enforceRowLimit, validateSql } from '../../security/sql-policy';
import { AGENT_NODES } from './constant';
import { getCheckpointer } from './memory';
import { getRunContext } from './run-context';
import { AgentState, type AgentDecision } from './state';

function buildGraph() {
  return new StateGraph(AgentState)
    .addNode(AGENT_NODES.APPROVAL, async state => {
      const decision = interrupt({
        kind: 'sql-approval',
        question: state.question,
        sql: state.sql,
        explanation: state.explanation,
        tables: state.tables,
        checks: state.checks,
        errors: state.validationErrors ?? [],
      }) as AgentDecision;
      return {
        decision,
        sql: decision.decision === 'edit' && decision.sql ? decision.sql : state.sql,
      };
    })
    .addNode(AGENT_NODES.REVALIDATE, async (state, config) => {
      const { connection } = getRunContext(config);
      const validation = validateSql(state.sql, connection.dialect, state.allowedObjects);
      if (!validation.valid) return { validationErrors: validation.errors };
      return {
        sql: enforceRowLimit(validation.sql, connection.dialect, connection.maxRows),
        tables: validation.tables,
        checks: validation.checks,
        validationErrors: [],
      };
    })
    .addNode(AGENT_NODES.EXECUTE, async (state, config) => {
      const context = getRunContext(config);
      const { connection } = context;
      // Validate again right before execution so nothing unchecked can ever reach the database.
      const validation = validateSql(state.sql, connection.dialect, state.allowedObjects);
      if (!validation.valid) throw new UserFacingError(validation.errors.join(' '));
      // The result stays in memory for this request and is never saved to the approval store.
      context.result = await executeReadOnly(
        connection,
        enforceRowLimit(validation.sql, connection.dialect, connection.maxRows),
      );
      return {};
    })
    .addEdge(START, AGENT_NODES.APPROVAL)
    .addConditionalEdges(AGENT_NODES.APPROVAL, state => {
      if (state.decision?.decision === 'approve') return AGENT_NODES.EXECUTE;
      if (state.decision?.decision === 'edit') return AGENT_NODES.REVALIDATE;
      return END;
    })
    .addEdge(AGENT_NODES.REVALIDATE, AGENT_NODES.APPROVAL)
    .addEdge(AGENT_NODES.EXECUTE, END)
    .compile({ name: 'text_to_sql_agent', checkpointer: getCheckpointer() });
}

let graph: ReturnType<typeof buildGraph> | undefined;

/** Built on first use so the approval database is not opened while Next.js builds. */
export function getGraph() {
  graph ??= buildGraph();
  return graph;
}
