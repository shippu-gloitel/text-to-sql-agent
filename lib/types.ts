import { z } from 'zod';

export const dialectSchema = z.enum(['postgresql', 'mysql', 'sqlite']);
export type Dialect = z.infer<typeof dialectSchema>;

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

export const schemaSnapshotSchema = z.object({
  tables: z.array(
    z.object({
      name: z.string(),
      schema: z.string().optional(),
      columns: z.array(z.object({ name: z.string(), type: z.string() })),
    }),
  ),
  fingerprint: z.string(),
});
export type SchemaSnapshot = z.infer<typeof schemaSnapshotSchema>;

export const runRequestSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  connection: connectionProfileSchema,
  model: modelProfileSchema,
  threadId: z.string().min(8).max(120),
});

export const resumeRequestSchema = z.object({
  threadId: z.string().min(8).max(120),
  decision: z.enum(['approve', 'reject', 'edit']),
  sql: z.string().max(20000).optional(),
  connection: connectionProfileSchema,
});

export type QueryColumn = { name: string; type?: string };
export type QueryResult = {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
};

export type StreamEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'stage.started' | 'stage.completed'; stage: string }
  | { type: 'sql.ready'; sql: string; explanation: string; tables: string[]; checks: string[] }
  | {
      type: 'approval.required';
      sql: string;
      explanation: string;
      tables: string[];
      checks: string[];
    }
  | { type: 'query.started' }
  | { type: 'result.metadata'; columns: QueryColumn[] }
  | { type: 'result.rows'; rows: Record<string, unknown>[] }
  | { type: 'result.completed'; result: QueryResult }
  | { type: 'run.completed'; answer: string }
  | { type: 'run.error'; message: string };
