import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import {
  modelProfileSchema,
  type ConnectionProfile,
  type ModelProfile,
  type QueryResult,
  type HistoryTurn,
  type SchemaSnapshot,
} from '../../types';
import { matchesAllowedObject } from '../../security/sql-policy';
import type { TableRowCount } from '../db';
import { boundRows } from '../result';
import { buildRepairPrompt, buildSystemPrompt } from './prompts';
import type { Draft } from './state';

const MODEL_TIMEOUT_MS = 90_000;

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

export function looksLikeDatabaseQuestion(question: string) {
  return /\b(data|database|table|tables|column|columns|schema|row|rows|record|records|user|users|count|counts|value|values|recent|latest|newest|oldest|join|joins|relationship|relationships|foreign\s+key)\b/i.test(
    question,
  );
}

export function isGreeting(question: string) {
  return /^(?:hi+|hello+|hey+|namaste|good\s+(?:morning|afternoon|evening))(?:\s+there)?[!.?,\s]*$/i.test(
    question.trim(),
  );
}

export function tableHint(schema: SchemaSnapshot) {
  const names = schema.tables.map(tableName);
  if (!names.length) return 'No user tables were discovered in the connected database.';

  return [`Available tables (${names.length}):`, ...names.map(name => `• ${name}`)].join('\n');
}

export function createModel(profile: ModelProfile) {
  const parsed = modelProfileSchema.parse(profile);
  return new ChatOpenAI({
    apiKey: parsed.apiKey,
    model: parsed.model,
    temperature: parsed.temperature,
    timeout: MODEL_TIMEOUT_MS,
    maxRetries: 1,
    configuration: parsed.baseUrl ? { baseURL: parsed.baseUrl } : undefined,
  });
}

export function tableName(table: SchemaSnapshot['tables'][number]) {
  return `${table.schema ? `${table.schema}.` : ''}${table.name}`;
}

export function restrictSchema(schema: SchemaSnapshot, allowedObjects: string[]): SchemaSnapshot {
  if (!allowedObjects.length) return schema;
  const tables = schema.tables.filter(table =>
    matchesAllowedObject(tableName(table), allowedObjects),
  );
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
export function extractPastedSql(question: string) {
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

export function isTableListQuestion(question: string) {
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
export function isRowCountQuestion(question: string) {
  const text = question.toLowerCase();
  const asksCount = /\b(how\s+many|count|counts|number\s+of|size|sizes)\b/.test(text);
  const aboutRows = /\b(rows?|records?|entries)\b/.test(text);
  const everyTable =
    /\b(each|every|all|per)\s+(the\s+)?tables?\b|\btables?\b.*\b(sizes?|row\s+counts?)\b/.test(
      text,
    );
  return asksCount && aboutRows && everyTable;
}

type CatalogRow = Record<string, unknown> & { schema: string | null };

/** Builds a catalog result, leaving out the schema column when no table has one (SQLite). */
function catalogResult(
  rows: CatalogRow[],
  columns: QueryResult['columns'],
  maxRows: number,
  maxResponseBytes: number,
) {
  if (rows.some(row => row.schema !== null))
    return boundRows(rows, columns, maxRows, maxResponseBytes, 0);
  return boundRows(
    rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'schema'))),
    columns.filter(column => column.name !== 'schema'),
    maxRows,
    maxResponseBytes,
    0,
  );
}

export function rowCountResult(
  counts: TableRowCount[],
  allowedObjects: string[],
  estimated: boolean,
  maxRows: number,
  maxResponseBytes: number,
) {
  const visible = allowedObjects.length
    ? counts.filter(count =>
        matchesAllowedObject(
          count.schema ? `${count.schema}.${count.table}` : count.table,
          allowedObjects,
        ),
      )
    : counts;
  const rowsColumn = estimated ? 'estimated_rows' : 'rows';
  return catalogResult(
    visible.map(count => ({ schema: count.schema, table: count.table, [rowsColumn]: count.rows })),
    [
      { name: 'schema', type: 'text' },
      { name: 'table', type: 'text' },
      { name: rowsColumn, type: 'number' },
    ],
    maxRows,
    maxResponseBytes,
  );
}

export function tableCatalogResult(
  schema: SchemaSnapshot,
  maxRows: number,
  maxResponseBytes: number,
) {
  const allRows = schema.tables.map(table => ({
    schema: table.schema ?? null,
    table: table.name,
    columns: table.columns.map(column => column.name).join(', '),
  }));
  return catalogResult(
    allRows,
    [
      { name: 'schema', type: 'text' },
      { name: 'table', type: 'text' },
      { name: 'columns', type: 'text' },
    ],
    maxRows,
    maxResponseBytes,
  );
}

type Relationship = SchemaSnapshot['relationships'][number];
type Table = SchemaSnapshot['tables'][number];

// Keeps very large legacy schemas from flooding the prompt.
const MAX_INFERRED_RELATIONSHIPS = 400;

function formatRelationship(relationship: Relationship) {
  const from = `${relationship.fromSchema ? `${relationship.fromSchema}.` : ''}${relationship.fromTable}`;
  const to = `${relationship.toSchema ? `${relationship.toSchema}.` : ''}${relationship.toTable}`;
  return `${from}.${relationship.fromColumn} -> ${to}.${relationship.toColumn}`;
}

/** Table names a `<stem>_id` column usually points to, e.g. role_id -> role, roles, mas_role. */
function tableNamesFor(stem: string) {
  const plural = stem.endsWith('y') ? `${stem.slice(0, -1)}ies` : `${stem}s`;
  return [stem, plural, `${stem}es`, `mas_${stem}`, `mas_${plural}`, `m_${stem}`, `tbl_${stem}`];
}

/**
 * Many databases (especially older ones) have no foreign keys. This infers likely joins from
 * naming conventions: a `<stem>_id` column links to a table named after the stem, using that table's
 * column of the same name or its `id` column. Columns already covered by a foreign key are skipped.
 */
export function inferRelationships(schema: SchemaSnapshot): Relationship[] {
  const known = new Set(
    schema.relationships.map(relationship =>
      `${relationship.fromSchema ?? ''}.${relationship.fromTable}.${relationship.fromColumn}`.toLowerCase(),
    ),
  );
  const byName = new Map<string, Table[]>();
  for (const table of schema.tables) {
    const key = table.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), table]);
  }

  const inferred: Relationship[] = [];
  for (const table of schema.tables) {
    for (const column of table.columns) {
      const columnName = column.name.toLowerCase();
      if (!columnName.endsWith('_id') || columnName === 'id') continue;
      if (known.has(`${table.schema ?? ''}.${table.name}.${column.name}`.toLowerCase())) continue;

      const candidates = tableNamesFor(columnName.slice(0, -3))
        .flatMap(name => byName.get(name) ?? [])
        .filter(target => target !== table)
        // Prefer a target in the same schema.
        .sort((a, b) => Number(b.schema === table.schema) - Number(a.schema === table.schema));
      for (const target of candidates) {
        const targetColumn =
          target.columns.find(candidate => candidate.name.toLowerCase() === columnName) ??
          target.columns.find(candidate => candidate.name.toLowerCase() === 'id');
        if (!targetColumn) continue;
        inferred.push({
          fromSchema: table.schema,
          fromTable: table.name,
          fromColumn: column.name,
          toSchema: target.schema,
          toTable: target.name,
          toColumn: targetColumn.name,
        });
        break;
      }
      if (inferred.length >= MAX_INFERRED_RELATIONSHIPS) return inferred;
    }
  }
  return inferred;
}

/** The relationship section of the prompt: real foreign keys first, then inferred joins. */
export function relationshipText(schema: SchemaSnapshot) {
  const sections: string[] = [];
  if (schema.relationships.length)
    sections.push(
      `Foreign keys (enforced by the database):\n${schema.relationships.map(formatRelationship).join('\n')}`,
    );
  const inferred = inferRelationships(schema);
  if (inferred.length)
    sections.push(
      `Likely relationships inferred from column names (not enforced by the database; use them when they fit the question):\n${inferred.map(formatRelationship).join('\n')}`,
    );
  return (
    sections.join('\n') ||
    'No relationships were discovered or inferred. Join only on columns whose names and types clearly match, and state the assumed join in the explanation.'
  );
}

export type DraftOptions = {
  signal?: AbortSignal;
  /** Earlier questions in this conversation and the SQL that answered them (never results). */
  history?: HistoryTurn[];
  /** A previously rejected attempt, sent back so the model can correct it. */
  rejected?: { sql: string; errors: string[] };
};

export async function createDraft(
  question: string,
  modelProfile: ModelProfile,
  connection: ConnectionProfile,
  schema: SchemaSnapshot,
  { signal, rejected, history }: DraftOptions = {},
): Promise<Draft> {
  const model = createModel(modelProfile).withStructuredOutput(DraftJsonSchema, {
    method: 'functionCalling',
    name: 'text_to_sql_draft',
    strict: true,
  });

  const schemaText = schema.tables
    .map(
      table =>
        `${tableName(table)}(${table.columns.map(column => `${column.name}:${column.type}`).join(', ')})`,
    )
    .join('\n');

  const messages: Array<[string, string]> = [
    [
      'system',
      buildSystemPrompt({
        connection,
        likelyDatabaseQuestion: looksLikeDatabaseQuestion(question),
        schemaText,
        relationshipText: relationshipText(schema),
      }),
    ],
    ...(history ?? []).flatMap((turn): Array<[string, string]> => [
      ['user', turn.question],
      ['assistant', turn.sql ? `SQL used:\n${turn.sql}` : 'No SQL was run for this question.'],
    ]),
    ['user', question],
  ];
  if (rejected) messages.push(['user', buildRepairPrompt(rejected.sql, rejected.errors)]);

  const response = await model.invoke(messages, { signal });
  return DraftSchema.parse(response);
}
