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

function looksLikeDatabaseQuestion(question: string) {
  return /\b(data|database|table|tables|column|columns|schema|row|rows|record|records|user|users|count|counts|value|values|recent|latest|newest|oldest|join|joins|relationship|relationships|foreign\s+key)\b/i.test(
    question,
  );
}

function tableHint(schema: SchemaSnapshot) {
  const names = schema.tables.map(
    table => `${table.schema ? `${table.schema}.` : ''}${table.name}`,
  );
  return names.length
    ? `Available tables: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''}.`
    : 'No user tables were discovered in the connected database.';
}

const State = Annotation.Root({
  question: Annotation<string>(),
  connection: Annotation<ConnectionProfile>(),
  model: Annotation<ModelProfile>(),
  allowedObjects: Annotation<string[]>(),
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
    const validation = validateSql(state.sql, state.connection.dialect, state.allowedObjects);
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

function tableName(table: SchemaSnapshot['tables'][number]) {
  return `${table.schema ? `${table.schema}.` : ''}${table.name}`;
}

function isAllowedObject(name: string, allowedObjects: string[]) {
  return allowedObjects.some(
    allowed => name === allowed || name.endsWith(`.${allowed}`) || allowed.endsWith(`.${name}`),
  );
}

function restrictSchema(schema: SchemaSnapshot, allowedObjects: string[]): SchemaSnapshot {
  if (!allowedObjects.length) return schema;
  const tables = schema.tables.filter(table => isAllowedObject(tableName(table), allowedObjects));
  const visibleNames = new Set(tables.map(table => tableName(table)));
  return {
    ...schema,
    tables,
    relationships: schema.relationships.filter(
      relationship =>
        visibleNames.has(
          `${relationship.fromSchema ? `${relationship.fromSchema}.` : ''}${relationship.fromTable}`,
        ) &&
        visibleNames.has(
          `${relationship.toSchema ? `${relationship.toSchema}.` : ''}${relationship.toTable}`,
        ),
    ),
  };
}

function extractPastedSql(question: string) {
  const trimmed = question.trim();
  const fenced = trimmed.match(/^```(?:sql|postgres(?:ql)?|mysql|sqlite)?\s*([\s\S]*?)\s*```$/i);
  const candidate = stripSqlComments(fenced?.[1]?.trim() ?? trimmed);
  return /^\s*(SELECT|WITH)\b/i.test(candidate) ? candidate : undefined;
}

function stripSqlComments(sql: string) {
  let output = '';
  let quote = '';
  let index = 0;
  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];
    if (quote) {
      output += current;
      if (current === quote) {
        if (next === quote) {
          output += next;
          index += 2;
          continue;
        }
        quote = '';
      }
      index += 1;
      continue;
    }
    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      output += current;
      index += 1;
      continue;
    }
    if (current === '-' && next === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n') index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    output += current;
    index += 1;
  }
  return output.trim();
}

function isTableListQuestion(question: string) {
  const asksAboutRowsOrColumns = /\b(row|rows|record|records|column|columns|data)\b/i.test(
    question,
  );
  return (
    /\b(table|tables|relation|relations)\b/i.test(question) &&
    !asksAboutRowsOrColumns &&
    (/\b(list|show|give|get|which|what|available|all)\b/i.test(question) ||
      /\bhow\s+many\b/i.test(question))
  );
}

function tableCatalogResult(schema: SchemaSnapshot, maxRows: number, maxResponseBytes: number) {
  const allRows = schema.tables.map(table => ({
    schema: table.schema ?? null,
    table: table.name,
    columns: table.columns.map(column => column.name).join(', '),
  }));
  const serializedRows = allRows.map(row => JSON.stringify(row));
  const rows: typeof allRows = [];
  let responseBytes = 2;
  for (let index = 0; index < allRows.length; index += 1) {
    const rowBytes = Buffer.byteLength(serializedRows[index]);
    const separatorBytes = rows.length ? 1 : 0;
    if (rows.length >= maxRows || responseBytes + separatorBytes + rowBytes > maxResponseBytes)
      break;
    rows.push(allRows[index]);
    responseBytes += separatorBytes + rowBytes;
  }
  const truncated = rows.length < allRows.length;
  return {
    columns: [
      { name: 'schema', type: 'text' },
      { name: 'table', type: 'text' },
      { name: 'columns', type: 'text' },
    ],
    rows,
    rowCount: rows.length,
    truncated,
    durationMs: 0,
  } satisfies QueryResult;
}

async function requestApproval(
  input: { question: string; connection: ConnectionProfile; model: ModelProfile; threadId: string },
  safeSql: string,
  explanation: string,
  validation: ReturnType<typeof validateSql>,
  allowedObjects: string[],
  emit: (event: Record<string, unknown>) => void,
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

async function createDraft(
  question: string,
  modelProfile: ModelProfile,
  connection: ConnectionProfile,
  schema: SchemaSnapshot,
): Promise<Draft> {
  const likelyDatabaseQuestion = looksLikeDatabaseQuestion(question);
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
  const relationshipText = schema.relationships.length
    ? schema.relationships
        .map(
          relationship =>
            `${relationship.fromSchema ? `${relationship.fromSchema}.` : ''}${relationship.fromTable}.${relationship.fromColumn} -> ${relationship.toSchema ? `${relationship.toSchema}.` : ''}${relationship.toTable}.${relationship.toColumn}`,
        )
        .join('\n')
    : 'No foreign-key relationships were discovered. Only join tables when the user provides a valid relationship.';
  const response = await model.invoke([
    [
      'system',
      `You are a strict read-only Text-to-SQL planner. Return JSON only. Treat questions about data, records, users, tables, columns, schema, row counts, table counts, recent records, latest users, or top values as database questions. The application routing hint for this request is ${likelyDatabaseQuestion ? 'DATABASE-RELATED' : 'UNKNOWN'}. If the hint is DATABASE-RELATED, never set isDatabaseQuestion false. For example, "How many rows are in each table?" is valid and should become one UNION ALL query with COUNT(*) for the discovered tables. "Show me the 10 most recent records", "Find the top 10 values by count", and "Find the latest 10 users" are also database questions. For latest/recent requests, use a discovered timestamp column such as created_at or updated_at; if no suitable discovered column exists, keep isDatabaseQuestion true, leave sql empty, and explain exactly what the user should specify. If a database question is vague, keep isDatabaseQuestion true and ask for the missing table or column instead of marking it off-topic. Set isDatabaseQuestion false only when the request is clearly unrelated to this connected database. Never invent tables or columns. Use the discovered foreign-key relationships when choosing JOINs. For joins, use explicit JOIN ... ON clauses and select only discovered columns. Generate one parameter-free SELECT or read-only WITH query for ${connection.dialect}. Always include LIMIT ${connection.maxRows} unless the query is a single aggregate. Do not use comments, DDL, DML, system functions, or multiple statements. Explain the query briefly without revealing private chain-of-thought. Schema:\n${schemaText}\nRelationships:\n${relationshipText}`,
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
      answer: `I can answer read-only questions about this connected database. Try asking about records, row counts, tables, or columns—for example, “How many rows are in each table?” ${tableHint(availableSchema)}`,
    });
    return;
  }
  if (!draft.sql.trim()) {
    emit({
      type: 'run.completed',
      answer: `${draft.explanation.trim() || 'I need a little more detail to create a safe query.'} ${tableHint(availableSchema)}`,
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
