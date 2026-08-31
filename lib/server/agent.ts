import { ChatOpenAI } from '@langchain/openai';
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  StateGraph,
  interrupt,
  isInterrupted,
} from '@langchain/langgraph';
import { createHash } from 'node:crypto';
import { executeReadOnly, introspect } from './db';
import { addSafetyLimit, validateSql } from '../security/sql-policy';
import {
  modelProfileSchema,
  type ConnectionProfile,
  type ModelProfile,
  type QueryResult,
  type SchemaSnapshot,
} from '../types';
import { z } from 'zod';

const DraftSchema = z.object({
  isDatabaseQuestion: z.boolean(),
  sql: z.string(),
  explanation: z.string(),
  assumptions: z.array(z.string()),
});

const DraftJsonSchema = {
  type: 'object',
  properties: {
    isDatabaseQuestion: { type: 'boolean' },
    sql: { type: 'string' },
    explanation: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
  required: ['isDatabaseQuestion', 'sql', 'explanation', 'assumptions'],
  additionalProperties: false,
} as const;

type Draft = {
  isDatabaseQuestion: boolean;
  sql: string;
  explanation: string;
  assumptions: string[];
};
type Decision = { decision: 'approve' | 'reject' | 'edit'; sql?: string };

const State = Annotation.Root({
  question: Annotation<string>(),
  connection: Annotation<ConnectionProfile>(),
  model: Annotation<ModelProfile>(),
  sql: Annotation<string>(),
  explanation: Annotation<string>(),
  tables: Annotation<string[]>(),
  checks: Annotation<string[]>(),
  decision: Annotation<Decision | undefined>(),
  result: Annotation<QueryResult | undefined>(),
});

const checkpointer = new MemorySaver();
const graph = new StateGraph(State)
  .addNode('approval', async state => {
    const decision = interrupt({
      kind: 'sql-approval',
      question: state.question,
      sql: state.sql,
      explanation: state.explanation,
      tables: state.tables,
      checks: state.checks,
    }) as Decision;
    return {
      decision,
      sql: decision.decision === 'edit' && decision.sql ? decision.sql : state.sql,
    };
  })
  .addNode('revalidate', async state => {
    const validation = validateSql(
      state.sql,
      state.connection.dialect,
      state.connection.allowedObjects,
    );
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    return {
      sql: addSafetyLimit(validation.sql, state.connection.maxRows),
      tables: validation.tables,
      checks: validation.checks,
    };
  })
  .addNode('execute', async state => ({
    result: await executeReadOnly(state.connection, state.sql),
  }))
  .addEdge('__start__', 'approval')
  .addConditionalEdges('approval', state => {
    if (state.decision?.decision === 'approve') return 'execute';
    if (state.decision?.decision === 'edit') return 'revalidate';
    return END;
  })
  .addEdge('revalidate', 'approval')
  .addEdge('execute', END)
  .compile({ checkpointer });

function createModel(profile: ModelProfile) {
  const parsed = modelProfileSchema.parse(profile);
  return new ChatOpenAI({
    apiKey: parsed.apiKey,
    model: parsed.model,
    temperature: parsed.temperature,
    configuration: parsed.baseUrl ? { baseURL: parsed.baseUrl } : undefined,
  });
}

async function createDraft(
  question: string,
  modelProfile: ModelProfile,
  connection: ConnectionProfile,
  schema: SchemaSnapshot,
): Promise<Draft> {
  const model = createModel(modelProfile).withStructuredOutput(DraftJsonSchema, {
    method: 'functionCalling',
    name: 'text_to_sql_draft',
    strict: true,
  });
  const schemaText = schema.tables
    .map(
      table =>
        `${table.schema ? `${table.schema}.` : ''}${table.name}(${table.columns.map(column => `${column.name}:${column.type}`).join(', ')})`,
    )
    .join('\n');
  const response = await model.invoke([
    [
      'system',
      `You are a strict read-only Text-to-SQL planner. Return JSON only. Treat questions about data, records, users, tables, columns, schema, row counts, table counts, or database structure as database questions. For example, "How many rows are in each table?" is a valid database question; generate one UNION ALL query with COUNT(*) for the discovered tables. Do not mark a database question as off-topic just because it does not name a table. If the user is clearly unrelated to the connected database, set isDatabaseQuestion false and leave sql empty. Never invent tables or columns. Generate one parameter-free SELECT or read-only WITH query for ${connection.dialect}. Always include LIMIT ${connection.maxRows} unless the query is a single aggregate. Do not use comments, DDL, DML, system functions, or multiple statements. Explain the query briefly without revealing private chain-of-thought. Schema:\n${schemaText}`,
    ],
    ['user', question],
  ]);
  return DraftSchema.parse(response);
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

export async function runAgent(
  input: { question: string; connection: ConnectionProfile; model: ModelProfile; threadId: string },
  emit: (event: Record<string, unknown>) => void,
) {
  const runId = createHash('sha256')
    .update(`${input.threadId}:${Date.now()}`)
    .digest('hex')
    .slice(0, 12);
  emit({ type: 'run.started', runId });
  emit({ type: 'stage.started', stage: 'Understanding question' });
  const schema = await introspect(input.connection);
  emit({ type: 'stage.completed', stage: 'Understanding question' });
  emit({ type: 'stage.started', stage: 'Reading schema' });
  emit({ type: 'stage.completed', stage: 'Reading schema', fingerprint: schema.fingerprint });
  emit({ type: 'stage.started', stage: 'Drafting SQL' });
  const draft = await createDraft(input.question, input.model, input.connection, schema);
  if (!draft.isDatabaseQuestion) {
    emit({
      type: 'run.completed',
      answer: `I can answer read-only questions about this connected database. Try asking about records, row counts, tables, or columns—for example, “How many rows are in each table?”${
        schema.tables.length
          ? ` Available tables: ${schema.tables
              .map(table => table.name)
              .slice(0, 8)
              .join(', ')}${schema.tables.length > 8 ? ', …' : ''}.`
          : ''
      }`,
    });
    return;
  }
  const allowed = input.connection.allowedObjects.length
    ? input.connection.allowedObjects
    : schema.tables.map(table => `${table.schema ? `${table.schema}.` : ''}${table.name}`);
  const validation = validateSql(draft.sql, input.connection.dialect, allowed);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const safeSql = addSafetyLimit(validation.sql, input.connection.maxRows);
  emit({ type: 'stage.completed', stage: 'Drafting SQL' });
  emit({ type: 'stage.completed', stage: 'Checking read-only safety' });
  emit({
    type: 'sql.ready',
    sql: safeSql,
    explanation: draft.explanation,
    tables: validation.tables,
    checks: validation.checks,
  });
  emit({ type: 'stage.started', stage: 'Waiting for approval' });

  const result = await graph.invoke(
    {
      ...input,
      sql: safeSql,
      explanation: draft.explanation,
      tables: validation.tables,
      checks: validation.checks,
    },
    { configurable: { thread_id: input.threadId } },
  );
  if (isInterrupted(result)) {
    const approval = result.__interrupt__?.[0]?.value;
    emit({ type: 'approval.required', ...(approval as Record<string, unknown>) });
    return;
  }
  await emitResult(result.result, emit);
}

export async function resumeAgent(
  threadId: string,
  decision: Decision,
  emit: (event: Record<string, unknown>) => void,
) {
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
