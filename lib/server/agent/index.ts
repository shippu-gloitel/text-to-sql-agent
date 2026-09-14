import { Command, isInterrupted } from '@langchain/langgraph';
import { createHash } from 'node:crypto';
import { introspect } from '../db';
import { addSafetyLimit, validateSql } from '../../security/sql-policy';
import type { ModelProfile, QueryResult } from '../../types';
import { graph } from './graph';
import {
  createDraft,
  createModel,
  extractPastedSql,
  isTableListQuestion,
  looksLikeDatabaseQuestion,
  restrictSchema,
  tableCatalogResult,
  tableHint,
  tableName,
  isGreeting,
} from './utils';
import type { AgentDecision, AgentEmit, AgentInput } from './state';

async function requestApproval(
  input: AgentInput,
  safeSql: string,
  explanation: string,
  validation: ReturnType<typeof validateSql>,
  allowedObjects: string[],
  emit: AgentEmit,
) {
  emit({
    type: 'sql.ready',
    sql: safeSql,
    explanation,
    tables: validation.tables,
    checks: validation.checks,
  });
  emit({ type: 'stage.started', stage: 'Waiting for approval' });

  const result = await graph.invoke(
    {
      ...input,
      sql: safeSql,
      explanation,
      tables: validation.tables,
      checks: validation.checks,
      allowedObjects,
    },
    { configurable: { thread_id: input.threadId } },
  );

  if (isInterrupted(result)) {
    const approval = result.__interrupt__?.[0]?.value;
    emit({ type: 'approval.required', ...(approval as Record<string, unknown>) });
    return true;
  }
  await emitResult(result.result, emit);
  return false;
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

export async function runAgent(input: AgentInput, emit: AgentEmit) {
  const runId = createHash('sha256')
    .update(`${input.threadId}:${Date.now()}`)
    .digest('hex')
    .slice(0, 12);

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

  const schema = await introspect(input.connection);
  emit({ type: 'stage.completed', stage: 'Understanding question' });
  emit({ type: 'stage.started', stage: 'Reading schema' });
  emit({ type: 'stage.completed', stage: 'Reading schema', fingerprint: schema.fingerprint });
  emit({ type: 'stage.started', stage: 'Drafting SQL' });

  const allowed = input.connection.allowedObjects.length
    ? input.connection.allowedObjects
    : schema.tables.map(tableName);
  const availableSchema = restrictSchema(schema, input.connection.allowedObjects);
  const pastedSql = extractPastedSql(input.question);

  if (pastedSql) {
    const validation = validateSql(pastedSql, input.connection.dialect, allowed);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    emit({ type: 'stage.completed', stage: 'Drafting SQL' });
    emit({ type: 'stage.completed', stage: 'Checking read-only safety' });
    await requestApproval(
      input,
      addSafetyLimit(validation.sql, input.connection.maxRows),
      'This is the read-only SQL you provided. Review it before execution.',
      validation,
      allowed,
      emit,
    );
    return;
  }

  if (isTableListQuestion(input.question)) {
    emit({ type: 'stage.completed', stage: 'Drafting SQL' });
    emit({ type: 'stage.started', stage: 'Preparing results' });
    const visibleSchema = restrictSchema(schema, input.connection.allowedObjects);
    await emitResult(
      tableCatalogResult(
        visibleSchema,
        input.connection.maxRows,
        input.connection.maxResponseBytes,
      ),
      emit,
    );
    return;
  }

  const draft = await createDraft(input.question, input.model, input.connection, availableSchema);
  const isDatabaseQuestion = draft.isDatabaseQuestion || looksLikeDatabaseQuestion(input.question);

  if (!isDatabaseQuestion) {
    emit({
      type: 'run.completed',
      answer: `I can help you explore this connected database with read-only queries.\n\nTry asking:\n• How many rows are in each table?\n• Show the five newest users.\n• Which columns does the users table have?\n\n${tableHint(availableSchema)}`,
    });
    return;
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

  const validation = validateSql(draft.sql, input.connection.dialect, allowed);
  if (!validation.valid) throw new Error(validation.errors.join(' '));

  const safeSql = addSafetyLimit(validation.sql, input.connection.maxRows);
  emit({ type: 'stage.completed', stage: 'Drafting SQL' });
  emit({ type: 'stage.completed', stage: 'Checking read-only safety' });
  await requestApproval(input, safeSql, draft.explanation, validation, allowed, emit);
}

export async function resumeAgent(threadId: string, decision: AgentDecision, emit: AgentEmit) {
  if (decision.decision === 'reject') {
    emit({ type: 'run.completed', answer: 'Query rejected. Nothing was executed.' });
    return;
  }
  emit({
    type: 'stage.started',
    stage: decision.decision === 'edit' ? 'Checking edited SQL' : 'Executing approved query',
  });
  const result = await graph.invoke(new Command({ resume: decision }), {
    configurable: { thread_id: threadId },
  });
  if (isInterrupted(result)) {
    const approval = result.__interrupt__?.[0]?.value;
    emit({ type: 'approval.required', ...(approval as Record<string, unknown>) });
    return;
  }
  await emitResult(result.result, emit);
}

async function emitResult(
  result: QueryResult | undefined,
  emit: (event: Record<string, unknown>) => void,
) {
  if (!result) throw new Error('The query completed without a result.');
  emit({ type: 'query.started' });
  emit({ type: 'result.metadata', columns: result.columns });
  for (let index = 0; index < result.rows.length; index += 50) {
    emit({ type: 'result.rows', rows: result.rows.slice(index, index + 50) });
  }
  emit({ type: 'result.completed', result });
  emit({
    type: 'run.completed',
    answer: result.rowCount
      ? `Returned ${result.rowCount} row${result.rowCount === 1 ? '' : 's'} from the database.`
      : 'The query returned no rows.',
  });
}
