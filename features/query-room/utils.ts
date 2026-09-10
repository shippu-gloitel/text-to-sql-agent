'use client';

import {
  connectionProfileSchema,
  modelProfileSchema,
  type ConnectionProfile,
  type ModelProfile,
  type QueryResult,
} from '@/lib/types';
import { LEGACY_STORAGE_KEYS, readStorage, STORAGE_KEYS } from '@/lib/storage';
import type { ChatMessage, ChatThread, ModelForm, SetupForm } from './types';

export const initialSetup: SetupForm = {
  name: 'Local analytics database',
  description: '',
  dialect: 'postgresql',
  host: 'localhost',
  port: '5432',
  database: '',
  username: '',
  password: '',
  path: '',
  ssl: false,
  allowedObjects: '',
  timeoutMs: '30000',
  maxRows: '500',
  maxResponseBytes: '5000000',
};

export const initialModel: ModelForm = {
  provider: 'openai',
  model: '',
  apiKey: '',
  baseUrl: '',
  temperature: '0',
};

export const defaultMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'Ask for a read-only view of your connected data. Try “How many rows are in each table?”, “Show the five newest users”, or “Which columns does the users table have?” Every generated query waits for your approval before it runs.',
};

export function threadTitle(messages: ChatMessage[]) {
  const question = messages.find(message => message.role === 'user')?.text?.trim();
  if (!question) return 'New conversation';

  const compact = question.replace(/\s+/g, ' ');
  return compact.length > 58 ? `${compact.slice(0, 58)}…` : compact;
}

export function isChatThread(value: unknown): value is ChatThread {
  if (!value || typeof value !== 'object') return false;
  const thread = value as Partial<ChatThread>;
  return (
    typeof thread.id === 'string' &&
    typeof thread.title === 'string' &&
    Array.isArray(thread.messages) &&
    typeof thread.createdAt === 'number' &&
    typeof thread.updatedAt === 'number'
  );
}

export function readThreads() {
  const current = readStorage<unknown>(STORAGE_KEYS.threads, null);
  if (Array.isArray(current)) return current.filter(isChatThread);

  const legacy = readStorage<unknown>(LEGACY_STORAGE_KEYS.threads, null);
  if (!Array.isArray(legacy) || !legacy.length) return [];

  const messages = legacy as ChatMessage[];
  if (!messages.some(message => message.role === 'user')) return [];

  const timestamp = Date.now();
  return [
    {
      id: `thread-${crypto.randomUUID()}`,
      title: threadTitle(messages),
      messages,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

export function makeConnection(form: SetupForm): ConnectionProfile {
  const common = {
    name: form.name.trim() || 'Untitled database',
    description: form.description,
    ssl: form.ssl,
    timeoutMs: Number(form.timeoutMs) || 30000,
    maxRows: Number(form.maxRows) || 500,
    maxResponseBytes: Number(form.maxResponseBytes) || 5000000,
    allowedObjects: form.allowedObjects
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
  };

  if (form.dialect === 'sqlite')
    return connectionProfileSchema.parse({ ...common, dialect: 'sqlite', path: form.path.trim() });

  return connectionProfileSchema.parse({
    ...common,
    dialect: form.dialect,
    host: form.host.trim(),
    port: Number(form.port),
    database: form.database.trim(),
    username: form.username.trim(),
    password: form.password,
  });
}

export function makeModel(form: ModelForm): ModelProfile {
  return modelProfileSchema.parse({
    provider: form.provider,
    model: form.model.trim(),
    apiKey: form.apiKey,
    baseUrl: form.baseUrl.trim(),
    temperature: Number(form.temperature) || 0,
  });
}

export function friendlyTestError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (
    !message ||
    error.name === 'ZodError' ||
    error.name === 'SyntaxError' ||
    /failed to fetch|networkerror|network request/i.test(message)
  )
    return fallback;
  return message;
}

export function updateMessage(messages: ChatMessage[], id: string, update: Partial<ChatMessage>) {
  return messages.map(message => (message.id === id ? { ...message, ...update } : message));
}

export async function consumeStream(
  url: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = 'The request could not be started.';
    try {
      const data = (await response.json()) as { message?: unknown };
      if (typeof data.message === 'string' && data.message.trim()) message = data.message;
    } catch {
      // Keep the safe fallback when the server does not return JSON.
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error('Streaming is not available in this browser.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(line => {
      if (line.trim()) onEvent(JSON.parse(line) as Record<string, unknown>);
    });
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as Record<string, unknown>);
}

export function formatCell(value: unknown) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(result: QueryResult) {
  const escape = (value: unknown) => `"${formatCell(value).replaceAll('"', '""')}"`;
  const header = result.columns.map(column => escape(column.name)).join(',');
  const rows = result.rows.map(row =>
    result.columns.map(column => escape(row[column.name])).join(','),
  );
  downloadBlob(
    new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }),
    'query-results.csv',
  );
}

export function exportJson(result: QueryResult) {
  downloadBlob(
    new Blob([JSON.stringify(result.rows, null, 2)], { type: 'application/json' }),
    'query-results.json',
  );
}

export async function exportXlsx(result: QueryResult) {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Results');
  worksheet.columns = result.columns.map(column => ({ header: column.name, key: column.name }));
  result.rows.forEach(row => worksheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'query-results.xlsx',
  );
}
