import { executeReadOnly, introspect, tableRowCounts } from '../db';
import { redact, UserFacingError } from '../error';
import { enforceRowLimit, validateSql, type SqlValidation } from '../../security/sql-policy';
import type { ConnectionProfile, ModelProfile, QueryResult } from '../../types';
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
import type { AgentEmit, AgentInput, ResumeInput } from './state';

// How many times the model may correct SQL that failed the safety check.
const MAX_REPAIR_ATTEMPTS = 2;

/** Tables a query may read: the configured allowlist, or every table the schema exposes. */
async function allowedTables(connection: ConnectionProfile) {
  if (connection.allowedObjects.length) return connection.allowedObjects;
  return (await introspect(connection)).tables.map(tableName);
}

/**
 * Sends SQL to the browser for review. The server keeps no state: the approval card holds the SQL
 * and sends it back with the decision, and it is validated again before anything runs.
 */
function requestApproval(
  runId: string,
  sql: string,
  explanation: string,
  validation: Pick<SqlValidation, 'tables' | 'checks' | 'errors'>,
  emit: AgentEmit,
) {
  if (!validation.errors.length)
    emit({
      type: 'sql.ready',
      sql,
      explanation,
      tables: validation.tables,
      checks: validation.checks,
    });
  emit({ type: 'stage.started', stage: 'Waiting for approval' });
  emit({
    type: 'approval.required',
    runId,
    sql,
    explanation,
    tables: validation.tables,
    checks: validation.checks,
    errors: validation.errors,
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
    requestApproval(
      runId,
      enforceRowLimit(validation.sql, dialect, maxRows),
      'This is the read-only SQL you provided. Review it before execution.',
      validation,
      emit,
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
    history: input.history,
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
      history: input.history,
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
  requestApproval(
    runId,
    enforceRowLimit(validation.sql, dialect, maxRows),
    draft.explanation,
    validation,
    emit,
  );
}

/**
 * Handles a decision from an approval card. The SQL comes from the browser, so it is always
 * validated here again; nothing unchecked can reach the database.
 */
export async function resumeAgent(input: ResumeInput, emit: AgentEmit) {
  const { runId, decision, connection } = input;
  if (decision === 'reject') {
    emit({ type: 'run.completed', answer: 'Query rejected. Nothing was executed.' });
    return;
  }

  const sql = input.sql?.trim();
  if (!sql) throw new UserFacingError('There is no SQL to run. Ask the question again.');
  const { dialect, maxRows } = connection;
  const validation = validateSql(sql, dialect, await allowedTables(connection));

  if (decision === 'edit') {
    emit({ type: 'stage.started', stage: 'Checking edited SQL' });
    requestApproval(
      runId,
      validation.valid ? enforceRowLimit(validation.sql, dialect, maxRows) : sql,
      input.explanation ?? '',
      validation,
      emit,
    );
    return;
  }

  if (!validation.valid) throw new UserFacingError(validation.errors.join(' '));
  emit({ type: 'stage.started', stage: 'Executing approved query' });
  const boundedSql = enforceRowLimit(validation.sql, dialect, maxRows);
  let result: QueryResult;
  try {
    result = await executeReadOnly(connection, boundedSql);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    // The database rejected the SQL (unknown column, type mismatch, timeout, ...). Show the
    // approval card again with the reason so the SQL can be edited or rejected.
    const reason = error instanceof Error ? redact(error.message) : 'Unknown database error.';
    requestApproval(
      runId,
      boundedSql,
      input.explanation ?? '',
      {
        tables: validation.tables,
        checks: validation.checks,
        errors: [`The database could not run this query: ${reason}`],
      },
      emit,
    );
    return;
  }
  emitResult(result, emit);
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
