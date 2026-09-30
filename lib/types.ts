import { z } from 'zod';

export type Dialect = 'postgresql' | 'mysql' | 'sqlite';

const sharedConnection = {
  name: z.string().min(1).max(80),
  description: z.string().max(240).default(''),
  ssl: z.boolean().default(false),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  maxRows: z.number().int().min(1).max(10000).default(500),
  maxResponseBytes: z.number().int().min(10000).max(50000000).default(5000000),
  allowedObjects: z.array(z.string().min(1)).max(200).default([]),
};

export const connectionProfileSchema = z.discriminatedUnion('dialect', [
  z.object({
    ...sharedConnection,
    dialect: z.literal('postgresql'),
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535).default(5432),
    database: z.string().min(1).max(255),
    username: z.string().min(1).max(255),
    password: z.string().max(2000),
  }),
  z.object({
    ...sharedConnection,
    dialect: z.literal('mysql'),
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535).default(3306),
    database: z.string().min(1).max(255),
    username: z.string().min(1).max(255),
    password: z.string().max(2000),
  }),
  z.object({
    ...sharedConnection,
    dialect: z.literal('sqlite'),
    path: z.string().min(1).max(1000),
    ssl: z.boolean().default(false),
  }),
]);
export type ConnectionProfile = z.infer<typeof connectionProfileSchema>;

export const modelProfileSchema = z.object({
  provider: z.enum(['openai']),
  model: z.string().min(1).max(120),
  apiKey: z.string().min(1).max(4000),
  baseUrl: z.string().url().optional().or(z.literal('')),
  temperature: z.number().min(0).max(1).default(0),
});
export type ModelProfile = z.infer<typeof modelProfileSchema>;

export type SchemaSnapshot = {
  tables: Array<{
    name: string;
    schema?: string;
    columns: Array<{ name: string; type: string }>;
  }>;
  relationships: Array<{
    fromSchema?: string;
    fromTable: string;
    fromColumn: string;
    toSchema?: string;
    toTable: string;
    toColumn: string;
  }>;
  fingerprint: string;
};

export const runRequestSchema = z.object({
  question: z.string().trim().min(2).max(20000),
  connection: connectionProfileSchema,
  model: modelProfileSchema,
  threadId: z.string().min(8).max(120),
});

export const resumeRequestSchema = z.object({
  threadId: z.string().min(8).max(120),
  runId: z.string().min(8).max(120),
  decision: z.enum(['approve', 'reject', 'edit']),
  sql: z.string().max(20000).optional(),
});

export type QueryColumn = { name: string; type?: string };
export type QueryResult = {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
};

export type ApprovalRequest = {
  runId: string;
  sql: string;
  explanation: string;
  tables: string[];
  checks: string[];
  errors: string[];
};

export type StreamEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'stage.started' | 'stage.completed'; stage: string }
  | { type: 'sql.ready'; sql: string; explanation: string; tables: string[]; checks: string[] }
  | ({ type: 'approval.required' } & ApprovalRequest)
  | { type: 'query.started' }
  | { type: 'result.completed'; result: QueryResult }
  | { type: 'run.completed'; answer: string }
  | { type: 'run.error'; message: string };
