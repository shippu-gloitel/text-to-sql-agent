import { Command, isInterrupted } from '@langchain/langgraph';
import { introspect, tableRowCounts } from '../db';
import { UserFacingError } from '../error';
import { enforceRowLimit, validateSql, type SqlValidation } from '../../security/sql-policy';
import type { ApprovalRequest, ConnectionProfile, ModelProfile, QueryResult } from '../../types';
import { getGraph } from './graph';
import { forgetCheckpoint, sweepExpiredCheckpoints, touchCheckpoint } from './memory';
import { withRunContext } from './run-context';
import {
  createDraft,
  createModel,
  extractPastedSql,
  isRowCountQuestion,
  isTableListQuestion,
  rowCountResult,
  looksLikeDatabaseQuestion,
  restrictSchema,
  tableCatalogResult,
  tableHint,
  tableName,
  isGreeting,
} from './utils';
import type { AgentDecision, AgentEmit, AgentInput } from './state';

// How many times the model may correct SQL that failed the safety check.
const MAX_REPAIR_ATTEMPTS = 2;

/** Every run gets its own checkpoint, so approving an older card can never run newer SQL. */
function checkpointId(threadId: string, runId: string) {
  return `${threadId}:${runId}`;
}

type GraphResult = Awaited<ReturnType<ReturnType<typeof getGraph>['invoke']>>;

async function handleGraphResult(
  result: GraphResult,
  queryResult: QueryResult | undefined,
  runId: string,
  checkpoint: string,
  emit: AgentEmit,
) {
  if (isInterrupted(result)) {
    const approval = result.__interrupt__?.[0]?.value as Omit<ApprovalRequest, 'runId'>;
    await touchCheckpoint(checkpoint);
    emit({
      type: 'approval.required',
      runId,
      sql: approval.sql,
      explanation: approval.explanation,
      tables: approval.tables,
      checks: approval.checks,
      errors: approval.errors ?? [],
    });
    return;
  }
  await forgetCheckpoint(checkpoint);
  emitResult(queryResult, emit);
}

async function requestApproval(
  input: AgentInput,
  runId: string,
  safeSql: string,
  explanation: string,
  validation: SqlValidation,
  allowedObjects: string[],
  emit: AgentEmit,
  signal?: AbortSignal,
) {
  emit({
    type: 'sql.ready',
    sql: safeSql,
    explanation,
    tables: validation.tables,
    checks: validation.checks,
  });
  emit({ type: 'stage.started', stage: 'Waiting for approval' });

  const checkpoint = checkpointId(input.threadId, runId);
  // Only non-secret fields go into the graph state, because it is saved to disk.
  await withRunContext(checkpoint, input.connection, async context => {
    const result = await getGraph().invoke(
      {
        question: input.question,
        sql: safeSql,
        explanation,
        tables: validation.tables,
        checks: validation.checks,
        validationErrors: [],
        allowedObjects,
      },
      { configurable: { thread_id: checkpoint }, signal },
    );
    await handleGraphResult(result, context.result, runId, checkpoint, emit);
  });
}

export async function testModel(profile: ModelProfile) {
  const started = performance.now();
  await createModel(profile).invoke('Reply with the single word READY.');
  return {
    ok: true,
    latencyMs: Math.round(performance.now() - started),
    model: profile.model,
    provider: profile.provider,
  };
}

export async function runAgent(input: AgentInput, emit: AgentEmit, signal?: AbortSignal) {
  const runId = crypto.randomUUID();

  emit({ type: 'run.started', runId });
  emit({ type: 'stage.started', stage: 'Understanding question' });
  if (isGreeting(input.question)) {
    emit({ type: 'stage.completed', stage: 'Understanding question' });
    emit({
      type: 'run.completed',
      answer:
        'Hi! 👋\n\nI can help you explore your connected database with read-only queries.\n\nTry asking:\n• How many rows are in each table?\n• Show the five newest users.\n• Which columns does the users table have?',
    });
    return;
  }
  emit({ type: 'stage.completed', stage: 'Understanding question' });

  emit({ type: 'stage.started', stage: 'Reading schema' });
  const schema = await introspect(input.connection);
  emit({ type: 'stage.completed', stage: 'Reading schema' });

  const { dialect, maxRows, maxResponseBytes, allowedObjects: configured } = input.connection;
  const allowed = configured.length ? configured : schema.tables.map(tableName);
  const availableSchema = restrictSchema(schema, configured);
  const pastedSql = extractPastedSql(input.question);

  if (pastedSql) {
    emit({ type: 'stage.started', stage: 'Checking read-only safety' });
    const validation = validateSql(pastedSql, dialect, allowed);
    if (!validation.valid) throw new UserFacingError(validation.errors.join(' '));
    emit({ type: 'stage.completed', stage: 'Checking read-only safety' });
    await requestApproval(
      input,
      runId,
      enforceRowLimit(validation.sql, dialect, maxRows),
      'This is the read-only SQL you provided. Review it before execution.',
      validation,
      allowed,
      emit,
      signal,
    );
    return;
  }

  if (isRowCountQuestion(input.question)) {
    emit({ type: 'stage.started', stage: 'Reading table statistics' });
    const { estimated, counts } = await tableRowCounts(input.connection);
    emitResult(
      rowCountResult(counts, configured, estimated, maxRows, maxResponseBytes),
      emit,
      estimated
        ? 'Row counts per table, from the database statistics. These are estimates that return instantly; ask for an exact count of a specific table if you need a precise number.'
        : undefined,
    );
    return;
  }

  if (isTableListQuestion(input.question)) {
    emit({ type: 'stage.started', stage: 'Preparing results' });
    emitResult(tableCatalogResult(availableSchema, maxRows, maxResponseBytes), emit);
    return;
  }

  emit({ type: 'stage.started', stage: 'Drafting SQL' });
  let draft = await createDraft(input.question, input.model, input.connection, availableSchema, {
    signal,
  });
  const isDatabaseQuestion = draft.isDatabaseQuestion || looksLikeDatabaseQuestion(input.question);

  if (!isDatabaseQuestion) {
    emit({
      type: 'run.completed',
      answer: `I can help you explore this connected database with read-only queries.\n\nTry asking:\n• How many rows are in each table?\n• Show the five newest users.\n• Which columns does the users table have?\n\n${tableHint(availableSchema)}`,
    });
    return;
  }

  let validation = validateSql(draft.sql, dialect, allowed);
  for (let attempt = 1; draft.sql.trim() && !validation.valid; attempt += 1) {
    if (attempt > MAX_REPAIR_ATTEMPTS)
      throw new UserFacingError(
        `The generated SQL did not pass the read-only safety check: ${validation.errors.join(' ')}`,
      );
    emit({ type: 'stage.started', stage: 'Correcting SQL' });
    draft = await createDraft(input.question, input.model, input.connection, availableSchema, {
      signal,
      rejected: { sql: draft.sql, errors: validation.errors },
    });
    validation = validateSql(draft.sql, dialect, allowed);
  }

  if (!draft.sql.trim()) {
    const explanation =
      draft.explanation.trim() || 'I need a little more detail to create a safe query.';
    emit({
      type: 'run.completed',
      answer: `${explanation}\n\n${tableHint(availableSchema)}`,
    });
    return;
  }

  emit({ type: 'stage.completed', stage: 'Drafting SQL' });
  emit({ type: 'stage.completed', stage: 'Checking read-only safety' });
  await requestApproval(
    input,
    runId,
    enforceRowLimit(validation.sql, dialect, maxRows),
    draft.explanation,
    validation,
    allowed,
    emit,
    signal,
  );
}

export async function resumeAgent(
  threadId: string,
  runId: string,
  decision: AgentDecision,
  connection: ConnectionProfile,
  emit: AgentEmit,
  signal?: AbortSignal,
) {
  const checkpoint = checkpointId(threadId, runId);
  const config = { configurable: { thread_id: checkpoint } };
  await sweepExpiredCheckpoints();
  const snapshot = await getGraph().getState(config);
  if (!snapshot.next.length)
    throw new UserFacingError(
      'This approval is no longer active. It may have expired or already been handled. Ask the question again to get a fresh query.',
    );

  if (decision.decision === 'reject') {
    await forgetCheckpoint(checkpoint);
    emit({ type: 'run.completed', answer: 'Query rejected. Nothing was executed.' });
    return;
  }
  emit({
    type: 'stage.started',
    stage: decision.decision === 'edit' ? 'Checking edited SQL' : 'Executing approved query',
  });
  try {
    // The browser sends the connection again; it is used for this request only, never stored.
    await withRunContext(checkpoint, connection, async context => {
      const result = await getGraph().invoke(new Command({ resume: decision }), {
        ...config,
        signal,
      });
      await handleGraphResult(result, context.result, runId, checkpoint, emit);
    });
  } catch (error) {
    // A failed execution ends the approval; the user can ask again with a new query.
    await forgetCheckpoint(checkpoint);
    throw error;
  }
}

function emitResult(result: QueryResult | undefined, emit: AgentEmit, answer?: string) {
  if (!result) throw new Error('The query completed without a result.');
  emit({ type: 'query.started' });
  emit({ type: 'result.completed', result });
  emit({
    type: 'run.completed',
    // The result card shows the row count (and says when there are none), so only add new text.
    answer: answer ?? '',
  });
}
