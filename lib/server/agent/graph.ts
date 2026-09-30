import { END, START, StateGraph, interrupt } from '@langchain/langgraph';
import { executeReadOnly } from '../db';
import { UserFacingError } from '../error';
import { enforceRowLimit, validateSql } from '../../security/sql-policy';
import { AGENT_NODES } from './constant';
import { checkpointer } from './memory';
import { AgentState, type AgentDecision } from './state';

export const graph = new StateGraph(AgentState)
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
  .addNode(AGENT_NODES.REVALIDATE, async state => {
    const validation = validateSql(state.sql, state.connection.dialect, state.allowedObjects);
    if (!validation.valid) return { validationErrors: validation.errors };
    return {
      sql: enforceRowLimit(validation.sql, state.connection.dialect, state.connection.maxRows),
      tables: validation.tables,
      checks: validation.checks,
      validationErrors: [],
    };
  })
  .addNode(AGENT_NODES.EXECUTE, async state => {
    // Validate again right before execution so nothing unchecked can ever reach the database.
    const validation = validateSql(state.sql, state.connection.dialect, state.allowedObjects);
    if (!validation.valid) throw new UserFacingError(validation.errors.join(' '));
    return {
      result: await executeReadOnly(
        state.connection,
        enforceRowLimit(validation.sql, state.connection.dialect, state.connection.maxRows),
      ),
    };
  })
  .addEdge(START, AGENT_NODES.APPROVAL)
  .addConditionalEdges(AGENT_NODES.APPROVAL, state => {
    if (state.decision?.decision === 'approve') return AGENT_NODES.EXECUTE;
    if (state.decision?.decision === 'edit') return AGENT_NODES.REVALIDATE;
    return END;
  })
  .addEdge(AGENT_NODES.REVALIDATE, AGENT_NODES.APPROVAL)
  .addEdge(AGENT_NODES.EXECUTE, END)
  .compile({ name: 'text_to_sql_agent', checkpointer });
