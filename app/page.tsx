'use client';

import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Copy,
  Database,
  Eye,
  EyeOff,
  FileJson,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Lock,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Table2,
  Terminal,
  Trash2,
  Unlock,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connectionProfileSchema,
  modelProfileSchema,
  type ConnectionProfile,
  type ModelProfile,
  type QueryResult,
} from '@/lib/types';
import {
  decryptSessionVault,
  decryptVault,
  encryptSessionVault,
  encryptVault,
  type VaultEnvelope,
} from '@/lib/security/vault';
import {
  clearAppStorage,
  clearSessionVault,
  LEGACY_STORAGE_KEYS,
  readSessionVault,
  readStorage,
  readVault,
  STORAGE_KEYS,
  writeSessionVault,
  writeStorage,
} from '@/lib/storage';

type CheckState = 'idle' | 'testing' | 'success' | 'error';
type SetupForm = {
  name: string;
  description: string;
  dialect: 'postgresql' | 'mysql' | 'sqlite';
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  path: string;
  ssl: boolean;
  allowedObjects: string;
  timeoutMs: string;
  maxRows: string;
  maxResponseBytes: string;
};
type ModelForm = {
  provider: 'openai';
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: string;
};
type StoredProfiles = { connection: ConnectionProfile; model: ModelProfile };
type Approval = { sql: string; explanation: string; tables: string[]; checks: string[] };
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  stages?: string[];
  currentStage?: string;
  sql?: string;
  approval?: Approval;
  result?: QueryResult;
  running?: boolean;
  rejected?: boolean;
};
type ChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

const initialSetup: SetupForm = {
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
const initialModel: ModelForm = {
  provider: 'openai',
  model: '',
  apiKey: '',
  baseUrl: '',
  temperature: '0',
};
const defaultMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'Ask for a read-only view of your connected data. Try “How many rows are in each table?”, “Show the five newest users”, or “Which columns does the users table have?” Every generated query waits for your approval before it runs.',
};

function threadTitle(messages: ChatMessage[]) {
  const question = messages.find(message => message.role === 'user')?.text?.trim();
  if (!question) return 'New conversation';
  const compact = question.replace(/\s+/g, ' ');
  return compact.length > 58 ? `${compact.slice(0, 58)}…` : compact;
}

function isChatThread(value: unknown): value is ChatThread {
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

function readThreads() {
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

function makeConnection(form: SetupForm): ConnectionProfile {
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

function makeModel(form: ModelForm): ModelProfile {
  return modelProfileSchema.parse({
    provider: form.provider,
    model: form.model.trim(),
    apiKey: form.apiKey,
    baseUrl: form.baseUrl.trim(),
    temperature: Number(form.temperature) || 0,
  });
}
function friendlyTestError(error: unknown, fallback: string) {
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
function updateMessage(messages: ChatMessage[], id: string, update: Partial<ChatMessage>) {
  return messages.map(message => (message.id === id ? { ...message, ...update } : message));
}

async function consumeStream(
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

function formatCell(value: unknown) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
function exportCsv(result: QueryResult) {
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
function exportJson(result: QueryResult) {
  downloadBlob(
    new Blob([JSON.stringify(result.rows, null, 2)], { type: 'application/json' }),
    'query-results.json',
  );
}
async function exportXlsx(result: QueryResult) {
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

export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  const [vault, setVault] = useState<VaultEnvelope | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [profiles, setProfiles] = useState<StoredProfiles | null>(null);
  const [setup, setSetup] = useState(initialSetup);
  const [modelForm, setModelForm] = useState(initialModel);
  const [dbAdvanced, setDbAdvanced] = useState(false);
  const [modelAdvanced, setModelAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [dbCheck, setDbCheck] = useState<{ state: CheckState; message?: string; details?: string }>(
    { state: 'idle' },
  );
  const [modelCheck, setModelCheck] = useState<{
    state: CheckState;
    message?: string;
    details?: string;
  }>({ state: 'idle' });
  const [messages, setMessages] = useState<ChatMessage[]>([defaultMessage]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [question, setQuestion] = useState('');
  const [threadId, setThreadId] = useState('');
  const [busy, setBusy] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [threadDeleteTarget, setThreadDeleteTarget] = useState<ChatThread | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const applyProfiles = useCallback((value: StoredProfiles) => {
    setProfiles(value);
    const savedThreads = readThreads();
    const activeThread = [...savedThreads].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    setThreads(savedThreads);
    setThreadId(activeThread?.id ?? `thread-${crypto.randomUUID()}`);
    setMessages(activeThread?.messages.length ? activeThread.messages : [defaultMessage]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreWorkspace = async () => {
      const savedVault = readVault();
      setVault(savedVault);
      if (savedVault) {
        const sessionVault = readSessionVault();
        if (sessionVault) {
          try {
            const restored = await decryptSessionVault<StoredProfiles>(sessionVault);
            if (!cancelled) applyProfiles(restored);
          } catch {
            clearSessionVault();
          }
        }
      }
      if (!cancelled) {
        setHydrated(true);
      }
    };
    void restoreWorkspace();
    return () => {
      cancelled = true;
    };
  }, [applyProfiles]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);
  useEffect(() => {
    if (!profiles) return;
    writeStorage(STORAGE_KEYS.threads, threads);
  }, [profiles, threads]);
  useEffect(() => {
    if (!profiles || !threadId || !messages.some(message => message.role === 'user')) return;
    setThreads(current => {
      const existing = current.find(thread => thread.id === threadId);
      const updated: ChatThread = {
        id: threadId,
        title:
          existing && existing.title !== 'New conversation'
            ? existing.title
            : threadTitle(messages),
        messages: messages.slice(-30),
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      return [updated, ...current.filter(thread => thread.id !== threadId)];
    });
  }, [messages, profiles, threadId]);
  const unlock = async () => {
    if (!vault || !passphrase) return;
    try {
      setUnlockError('');
      const restored = await decryptVault<StoredProfiles>(vault, passphrase);
      writeSessionVault(await encryptSessionVault(restored));
      applyProfiles(restored);
    } catch {
      setUnlockError('That passphrase could not unlock this workspace.');
    }
  };
  const testDatabase = async () => {
    const fallbackMessage =
      'Database connection failed. Check the host, port, database, and credentials.';
    try {
      setDbCheck({ state: 'testing' });
      const connection = makeConnection(setup);
      const response = await fetch('/api/health/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connection),
      });
      const data = (await response.json()) as {
        ok: boolean;
        version?: string;
        latencyMs?: number;
        message?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.message?.trim() || fallbackMessage);
      }
      setDbCheck({
        state: 'success',
        message: 'Connected and ready',
        details: `${data.version} · ${data.latencyMs}ms`,
      });
    } catch (error) {
      setDbCheck({
        state: 'error',
        message: friendlyTestError(error, fallbackMessage),
      });
    }
  };
  const testModel = async () => {
    const fallbackMessage = 'Model connection failed. Check the provider, model, and API key.';
    try {
      setModelCheck({ state: 'testing' });
      const model = makeModel(modelForm);
      const response = await fetch('/api/health/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(model),
      });
      const data = (await response.json()) as {
        ok: boolean;
        model?: string;
        provider?: string;
        latencyMs?: number;
        message?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.message?.trim() || fallbackMessage);
      }
      setModelCheck({
        state: 'success',
        message: 'Model is responding',
        details: `${data.provider} · ${data.model} · ${data.latencyMs}ms`,
      });
    } catch (error) {
      setModelCheck({
        state: 'error',
        message: friendlyTestError(error, fallbackMessage),
      });
    }
  };
  const resetDatabaseForm = () => {
    setSetup({ ...initialSetup });
    setDbAdvanced(false);
    setShowPassword(false);
    setDbCheck({ state: 'idle' });
  };
  const resetModelForm = () => {
    setModelForm({ ...initialModel });
    setModelAdvanced(false);
    setShowApiKey(false);
    setModelCheck({ state: 'idle' });
  };
  const saveWorkspace = async () => {
    if (!passphrase || dbCheck.state !== 'success' || modelCheck.state !== 'success') return;
    try {
      const value = { connection: makeConnection(setup), model: makeModel(modelForm) };
      const encrypted = await encryptVault(value, passphrase);
      writeStorage(STORAGE_KEYS.vault, encrypted);
      writeSessionVault(await encryptSessionVault(value));
      setVault(encrypted);
      applyProfiles(value);
    } catch {
      setDbCheck({ state: 'error', message: 'Complete the required fields before saving.' });
    }
  };
  const requestClearWorkspace = () => setDeleteConfirmOpen(true);
  const deleteWorkspace = () => {
    clearAppStorage();
    clearSessionVault();
    setDeleteConfirmOpen(false);
    setVault(null);
    setProfiles(null);
    setPassphrase('');
    setMessages([defaultMessage]);
    setDbCheck({ state: 'idle' });
    setModelCheck({ state: 'idle' });
  };
  const lockWorkspace = () => {
    clearSessionVault();
    setProfiles(null);
    setPassphrase('');
  };
  const startNewThread = () => {
    if (busy) return;
    const id = `thread-${crypto.randomUUID()}`;
    const timestamp = Date.now();
    setThreads(current => [
      {
        id,
        title: 'New conversation',
        messages: [defaultMessage],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ...current,
    ]);
    setThreadId(id);
    setMessages([defaultMessage]);
    setQuestion('');
  };
  const selectThread = (id: string) => {
    if (busy) return;
    const selected = threads.find(thread => thread.id === id);
    if (!selected) return;
    setThreadId(selected.id);
    setMessages(selected.messages);
    setQuestion('');
  };
  const renameThread = (id: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setThreads(current =>
      current.map(thread => (thread.id === id ? { ...thread, title: nextTitle } : thread)),
    );
  };
  const requestDeleteThread = (id: string) => {
    if (busy) return;
    setThreadDeleteTarget(threads.find(thread => thread.id === id) ?? null);
  };
  const deleteThread = () => {
    if (!threadDeleteTarget) return;
    const deletedId = threadDeleteTarget.id;
    setThreads(current => current.filter(thread => thread.id !== deletedId));
    if (deletedId === threadId) {
      setThreadId(`thread-${crypto.randomUUID()}`);
      setMessages([defaultMessage]);
      setQuestion('');
    }
    setThreadDeleteTarget(null);
  };
  const streamRun = async (url: string, body: unknown, assistantId: string) => {
    try {
      await consumeStream(url, body, event => {
        const type = String(event.type);
        if (type === 'stage.started')
          setMessages(current =>
            updateMessage(current, assistantId, {
              currentStage: String(event.stage),
              stages: [
                ...(current.find(item => item.id === assistantId)?.stages ?? []),
                String(event.stage),
              ],
            }),
          );
        if (type === 'sql.ready')
          setMessages(current => updateMessage(current, assistantId, { sql: String(event.sql) }));
        if (type === 'approval.required')
          setMessages(current =>
            updateMessage(current, assistantId, {
              approval: {
                sql: String(event.sql),
                explanation: String(event.explanation),
                tables: (event.tables as string[]) ?? [],
                checks: (event.checks as string[]) ?? [],
              },
              running: false,
              currentStage: 'Waiting for approval',
            }),
          );
        if (type === 'result.completed')
          setMessages(current =>
            updateMessage(current, assistantId, {
              result: event.result as QueryResult,
              currentStage: 'Results ready',
              running: false,
            }),
          );
        if (type === 'run.completed')
          setMessages(current =>
            updateMessage(current, assistantId, {
              text: String(event.answer),
              running: false,
              currentStage: undefined,
            }),
          );
        if (type === 'run.error')
          setMessages(current =>
            updateMessage(current, assistantId, {
              text: String(event.message),
              running: false,
              rejected: true,
              currentStage: undefined,
            }),
          );
      });
    } catch (error) {
      setMessages(current =>
        updateMessage(current, assistantId, {
          text: error instanceof Error ? error.message : 'The stream ended unexpectedly.',
          running: false,
          rejected: true,
        }),
      );
    } finally {
      setBusy(false);
    }
  };
  const submitQuestion = async () => {
    if (!profiles || !threadId || !question.trim() || busy) return;
    const userText = question.trim();
    const assistantId = `assistant-${crypto.randomUUID()}`;
    setQuestion('');
    setBusy(true);
    setMessages(current => [
      ...current,
      { id: `user-${crypto.randomUUID()}`, role: 'user', text: userText },
      {
        id: assistantId,
        role: 'assistant',
        running: true,
        stages: [],
        currentStage: 'Understanding question',
      },
    ]);
    await streamRun(
      '/api/agent/run',
      { question: userText, connection: profiles.connection, model: profiles.model, threadId },
      assistantId,
    );
  };
  const resume = async (
    assistantId: string,
    decision: 'approve' | 'reject' | 'edit',
    sql?: string,
  ) => {
    if (!profiles || !threadId || busy) return;
    setBusy(true);
    setMessages(current =>
      updateMessage(current, assistantId, {
        approval: undefined,
        running: decision !== 'reject',
        currentStage:
          decision === 'reject'
            ? undefined
            : decision === 'edit'
              ? 'Checking edited SQL'
              : 'Executing approved query',
      }),
    );
    await streamRun(
      '/api/agent/resume',
      { threadId, decision, sql, connection: profiles.connection },
      assistantId,
    );
  };
  if (!hydrated) return <div className='loading-screen'>Loading workspace…</div>;
  const screen =
    vault && !profiles ? (
      <UnlockScreen
        passphrase={passphrase}
        setPassphrase={setPassphrase}
        unlock={unlock}
        clearWorkspace={requestClearWorkspace}
        error={unlockError}
      />
    ) : profiles ? (
      <ChatScreen
        profiles={profiles}
        messages={messages}
        threads={threads}
        activeThreadId={threadId}
        question={question}
        setQuestion={setQuestion}
        busy={busy}
        scrollRef={scrollRef}
        submitQuestion={submitQuestion}
        resume={resume}
        startNewThread={startNewThread}
        selectThread={selectThread}
        renameThread={renameThread}
        requestDeleteThread={requestDeleteThread}
        lockWorkspace={lockWorkspace}
        clearWorkspace={requestClearWorkspace}
      />
    ) : (
      <SetupScreen
        setup={setup}
        setSetup={setSetup}
        model={modelForm}
        setModel={setModelForm}
        dbAdvanced={dbAdvanced}
        setDbAdvanced={setDbAdvanced}
        modelAdvanced={modelAdvanced}
        setModelAdvanced={setModelAdvanced}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        showApiKey={showApiKey}
        setShowApiKey={setShowApiKey}
        passphrase={passphrase}
        setPassphrase={setPassphrase}
        dbCheck={dbCheck}
        modelCheck={modelCheck}
        setDbCheck={setDbCheck}
        setModelCheck={setModelCheck}
        testDatabase={testDatabase}
        testModel={testModel}
        resetDatabaseForm={resetDatabaseForm}
        resetModelForm={resetModelForm}
        saveWorkspace={saveWorkspace}
      />
    );
  return (
    <>
      {screen}
      {deleteConfirmOpen && (
        <DeleteWorkspaceModal
          cancel={() => setDeleteConfirmOpen(false)}
          confirm={async candidate => {
            if (!vault || !candidate.trim()) return false;
            try {
              await decryptVault(vault, candidate);
              deleteWorkspace();
              return true;
            } catch {
              return false;
            }
          }}
        />
      )}
      {threadDeleteTarget && (
        <DeleteThreadModal
          title={threadDeleteTarget.title}
          cancel={() => setThreadDeleteTarget(null)}
          confirm={deleteThread}
        />
      )}
    </>
  );
}

function DeleteWorkspaceModal({
  cancel,
  confirm,
}: {
  cancel: () => void;
  confirm: (passphrase: string) => Promise<boolean>;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cancel]);

  return (
    <div className='modal-backdrop' role='presentation' onMouseDown={cancel}>
      <section
        className='confirm-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='clear-workspace-title'
        onMouseDown={event => event.stopPropagation()}
      >
        <div className='modal-icon'>
          <Trash2 size={18} />
        </div>
        <p className='eyebrow'>Local workspace</p>
        <h2 id='clear-workspace-title'>Clear this workspace?</h2>
        <p className='muted'>This permanently removes the following local data:</p>
        <div className='delete-list'>
          <span>
            <KeyRound size={15} /> Encrypted database and model profiles
          </span>
          <span>
            <MessageSquare size={15} /> Local conversation history
          </span>
          <span>
            <Database size={15} /> Saved workspace settings
          </span>
        </div>
        <p className='modal-warning'>This action cannot be undone.</p>
        <label className='field-label' htmlFor='clear-vault-passphrase'>
          Confirm with vault passphrase
        </label>
        <div className='input-wrap modal-passphrase'>
          <Lock size={16} />
          <input
            id='clear-vault-passphrase'
            type='password'
            value={passphrase}
            onChange={event => {
              setPassphrase(event.target.value);
              setError('');
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && passphrase && !checking) {
                event.preventDefault();
                void handleConfirm();
              }
            }}
            placeholder='Enter your vault passphrase'
            autoFocus
          />
        </div>
        {error && (
          <p className='error-line'>
            <CircleAlert size={15} />
            {error}
          </p>
        )}
        <div className='modal-actions'>
          <button className='ghost-button' onClick={cancel} disabled={checking}>
            Keep workspace
          </button>
          <button
            className='danger-button'
            onClick={() => void handleConfirm()}
            disabled={!passphrase || checking}
          >
            {checking ? <RefreshCw className='spin' size={15} /> : <Trash2 size={15} />}
            {checking ? 'Checking passphrase…' : 'Clear workspace'}
          </button>
        </div>
      </section>
    </div>
  );

  async function handleConfirm() {
    setChecking(true);
    setError('');
    const verified = await confirm(passphrase);
    if (!verified) {
      setError('Incorrect vault passphrase. Nothing was deleted.');
      setChecking(false);
    }
  }
}

function DeleteThreadModal({
  title,
  cancel,
  confirm,
}: {
  title: string;
  cancel: () => void;
  confirm: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cancel]);

  return (
    <div className='modal-backdrop' role='presentation' onMouseDown={cancel}>
      <section
        className='confirm-modal thread-delete-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='delete-thread-title'
        onMouseDown={event => event.stopPropagation()}
      >
        <div className='modal-icon'>
          <Trash2 size={18} />
        </div>
        <p className='eyebrow'>Conversation</p>
        <h2 id='delete-thread-title'>Delete this chat?</h2>
        <p className='muted'>
          The following conversation and its local messages will be permanently removed.
        </p>
        <div className='thread-delete-name'>“{title}”</div>
        <p className='modal-warning'>This action cannot be undone.</p>
        <div className='modal-actions'>
          <button className='ghost-button' onClick={cancel} autoFocus>
            Keep chat
          </button>
          <button className='danger-button' onClick={confirm}>
            <Trash2 size={15} /> Delete chat
          </button>
        </div>
      </section>
    </div>
  );
}

function UnlockScreen({
  passphrase,
  setPassphrase,
  unlock,
  clearWorkspace,
  error,
}: {
  passphrase: string;
  setPassphrase: (value: string) => void;
  unlock: () => void;
  clearWorkspace: () => void;
  error: string;
}) {
  return (
    <main className='center-stage'>
      <div className='unlock-card'>
        <div className='brand-mark'>
          <Lock size={18} />
        </div>
        <p className='eyebrow'>Encrypted workspace</p>
        <h1>Welcome back.</h1>
        <p className='muted'>Unlock your local database and model profiles to continue.</p>
        <label className='field-label' htmlFor='unlock-passphrase'>
          Vault passphrase
        </label>
        <div className='input-wrap'>
          <Lock size={16} />
          <input
            id='unlock-passphrase'
            type='password'
            value={passphrase}
            onChange={event => setPassphrase(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && unlock()}
            placeholder='Enter your passphrase'
            autoFocus
          />
        </div>
        {error && (
          <p className='error-line'>
            <CircleAlert size={15} />
            {error}
          </p>
        )}
        <button className='primary-button full-width' onClick={unlock}>
          <Unlock size={16} />
          Unlock workspace
        </button>
        <button className='text-button danger-text-button' onClick={clearWorkspace}>
          <Trash2 size={14} />
          Clear this workspace
        </button>
      </div>
    </main>
  );
}

function SetupScreen(props: {
  setup: SetupForm;
  setSetup: React.Dispatch<React.SetStateAction<SetupForm>>;
  model: ModelForm;
  setModel: React.Dispatch<React.SetStateAction<ModelForm>>;
  dbAdvanced: boolean;
  setDbAdvanced: (value: boolean) => void;
  modelAdvanced: boolean;
  setModelAdvanced: (value: boolean) => void;
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
  showApiKey: boolean;
  setShowApiKey: (value: boolean) => void;
  passphrase: string;
  setPassphrase: (value: string) => void;
  dbCheck: { state: CheckState; message?: string; details?: string };
  modelCheck: { state: CheckState; message?: string; details?: string };
  setDbCheck: React.Dispatch<
    React.SetStateAction<{ state: CheckState; message?: string; details?: string }>
  >;
  setModelCheck: React.Dispatch<
    React.SetStateAction<{ state: CheckState; message?: string; details?: string }>
  >;
  testDatabase: () => void;
  testModel: () => void;
  resetDatabaseForm: () => void;
  resetModelForm: () => void;
  saveWorkspace: () => void;
}) {
  const { setup, setSetup, model, setModel } = props;
  const set = (key: keyof SetupForm, value: string | boolean) =>
    setSetup(current => ({ ...current, [key]: value }));
  const setModelValue = (key: keyof ModelForm, value: string) =>
    setModel(current => ({ ...current, [key]: value }));
  const setDatabaseValue = (key: keyof SetupForm, value: string | boolean) => {
    set(key, value);
    props.setDbCheck({ state: 'idle' });
  };
  const setModelField = (key: keyof ModelForm, value: string) => {
    setModelValue(key, value);
    props.setModelCheck({ state: 'idle' });
  };
  const dialects = [
    { value: 'postgresql', label: 'PostgreSQL', note: 'Default', icon: '◉' },
    { value: 'mysql', label: 'MySQL', note: 'Reliable', icon: '◈' },
    { value: 'sqlite', label: 'SQLite', note: 'Local file', icon: '▣' },
  ] as const;
  return (
    <main className='setup-page'>
      <header className='topbar'>
        <div className='brand'>
          <div className='brand-mark'>
            <Sparkles size={18} />
          </div>
          <div>
            <span className='brand-name'>Queryroom</span>
            <span className='brand-subtitle'>Read-only data intelligence</span>
          </div>
        </div>
        <span className='status-pill'>
          <span className='status-dot' />
          Setup mode
        </span>
      </header>
      <div className='setup-heading'>
        <div>
          <p className='eyebrow'>Workspace setup · 01</p>
          <h1>Connect your data room.</h1>
          <p className='lede'>
            Give your agent a safe, read-only view of a database. You stay in control of every
            query.
          </p>
        </div>
        <div className='setup-progress'>
          <span className='progress-active' />
          <span />
          <span />
        </div>
      </div>
      <div className='setup-grid'>
        <section className='setup-card'>
          <SectionTitle
            number='01'
            icon={<Database size={18} />}
            title='Database connection'
            subtitle='Where should Queryroom look for answers?'
          />
          <div className='form-grid'>
            <Field label='Profile name' hint='A friendly name for this connection' className='wide'>
              <input
                value={setup.name}
                onChange={event => setDatabaseValue('name', event.target.value)}
                placeholder='e.g. Production analytics'
              />
            </Field>
            <Field label='Description' hint='Optional notes about this database' className='wide'>
              <textarea
                value={setup.description}
                onChange={event => setDatabaseValue('description', event.target.value)}
                placeholder='What kind of data lives here?'
                rows={2}
              />
            </Field>
          </div>
          <label className='field-label'>Database type</label>
          <div className='dialect-grid'>
            {dialects.map(dialect => (
              <button
                key={dialect.value}
                className={`dialect-card ${setup.dialect === dialect.value ? 'selected' : ''}`}
                onClick={() => {
                  setDatabaseValue('dialect', dialect.value);
                  setDatabaseValue('port', dialect.value === 'postgresql' ? '5432' : '3306');
                }}
              >
                <span className='dialect-icon'>{dialect.icon}</span>
                <span className='dialect-label'>{dialect.label}</span>
                <span className='dialect-note'>{dialect.note}</span>
                {setup.dialect === dialect.value && <Check className='dialect-check' size={16} />}
              </button>
            ))}
          </div>
          {setup.dialect === 'sqlite' ? (
            <div className='form-grid'>
              <Field
                label='Database file path'
                hint='The path must be visible to the Node server'
                className='wide'
              >
                <div className='input-wrap'>
                  <Terminal size={16} />
                  <input
                    value={setup.path}
                    onChange={event => setDatabaseValue('path', event.target.value)}
                    placeholder='/var/data/analytics.sqlite'
                  />
                </div>
              </Field>
              <div className='readonly-callout'>
                <ShieldCheck size={17} />
                <div>
                  <strong>Read-only is always on</strong>
                  <span>SQLite writes are disabled at the driver level.</span>
                </div>
              </div>
            </div>
          ) : (
            <div className='form-grid'>
              <Field label='Host' required>
                <input
                  value={setup.host}
                  onChange={event => setDatabaseValue('host', event.target.value)}
                  placeholder='localhost or 192.168.1.100'
                />
              </Field>
              <Field label='Port' required>
                <input
                  value={setup.port}
                  onChange={event => setDatabaseValue('port', event.target.value)}
                  inputMode='numeric'
                />
              </Field>
              <Field label='Database name' required>
                <input
                  value={setup.database}
                  onChange={event => setDatabaseValue('database', event.target.value)}
                  placeholder='analytics'
                />
              </Field>
              <Field label='Username' required>
                <input
                  value={setup.username}
                  onChange={event => setDatabaseValue('username', event.target.value)}
                  placeholder='readonly_user'
                />
              </Field>
              <Field label='Password' required>
                <div className='input-wrap'>
                  <KeyRound size={16} />
                  <input
                    type={props.showPassword ? 'text' : 'password'}
                    value={setup.password}
                    onChange={event => setDatabaseValue('password', event.target.value)}
                    placeholder='Database password'
                  />
                  <button
                    className='icon-button'
                    onClick={() => props.setShowPassword(!props.showPassword)}
                    aria-label={props.showPassword ? 'Hide password' : 'Show password'}
                  >
                    {props.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
              <label className='switch-row'>
                <input
                  type='checkbox'
                  checked={setup.ssl}
                  onChange={event => setDatabaseValue('ssl', event.target.checked)}
                />
                <span className='switch' />
                <span>
                  <strong>Use SSL</strong>
                  <small>Require an encrypted connection</small>
                </span>
              </label>
            </div>
          )}
          <button
            className='advanced-toggle'
            onClick={() => props.setDbAdvanced(!props.dbAdvanced)}
          >
            <span>
              <ChevronDown size={16} className={props.dbAdvanced ? 'rotate' : ''} />
              Advanced safety limits
            </span>
            <small>Allowlist, timeout, row and response caps</small>
          </button>
          {props.dbAdvanced && (
            <div className='advanced-panel'>
              <Field
                label='Allowed tables or schemas'
                hint='Comma-separated; leave blank to use discovered schema'
                className='wide'
              >
                <input
                  value={setup.allowedObjects}
                  onChange={event => setDatabaseValue('allowedObjects', event.target.value)}
                  placeholder='public.customers, public.orders'
                />
              </Field>
              <div className='form-grid'>
                <Field label='Query timeout (ms)'>
                  <input
                    value={setup.timeoutMs}
                    onChange={event => setDatabaseValue('timeoutMs', event.target.value)}
                    inputMode='numeric'
                  />
                </Field>
                <Field label='Maximum rows'>
                  <input
                    value={setup.maxRows}
                    onChange={event => setDatabaseValue('maxRows', event.target.value)}
                    inputMode='numeric'
                  />
                </Field>
                <Field label='Maximum response bytes'>
                  <input
                    value={setup.maxResponseBytes}
                    onChange={event => setDatabaseValue('maxResponseBytes', event.target.value)}
                    inputMode='numeric'
                  />
                </Field>
              </div>
            </div>
          )}
          <div className='test-row'>
            <TestStatus {...props.dbCheck} />
            <div className='test-actions'>
              <button
                className='ghost-button reset-form-button'
                onClick={props.resetDatabaseForm}
                disabled={props.dbCheck.state === 'testing'}
              >
                <RefreshCw size={15} />
                Reset form
              </button>
              <button
                className='outline-button'
                onClick={props.testDatabase}
                disabled={props.dbCheck.state === 'testing'}
              >
                {props.dbCheck.state === 'testing' ? (
                  <RefreshCw className='spin' size={16} />
                ) : (
                  <Zap size={16} />
                )}
                Test database connection
              </button>
            </div>
          </div>
        </section>
        <section className='setup-card'>
          <SectionTitle
            number='02'
            icon={<Sparkles size={18} />}
            title='Model connection'
            subtitle='The reasoning layer behind your data room.'
          />
          <div className='provider-card selected'>
            <span className='provider-logo'>◎</span>
            <div>
              <strong>OpenAI</strong>
              <small>Use an OpenAI-compatible chat model</small>
            </div>
            <Check size={16} className='provider-check' />
          </div>
          <div className='form-grid'>
            <Field label='Model' required className='wide'>
              <input
                value={model.model}
                onChange={event => setModelField('model', event.target.value)}
                placeholder='Enter a model identifier'
              />
            </Field>
            <Field label='API key' required className='wide'>
              <div className='input-wrap'>
                <KeyRound size={16} />
                <input
                  type={props.showApiKey ? 'text' : 'password'}
                  value={model.apiKey}
                  onChange={event => setModelField('apiKey', event.target.value)}
                  placeholder='sk-…'
                />
                <button
                  className='icon-button'
                  onClick={() => props.setShowApiKey(!props.showApiKey)}
                  aria-label={props.showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {props.showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          </div>
          <button
            className='advanced-toggle'
            onClick={() => props.setModelAdvanced(!props.modelAdvanced)}
          >
            <span>
              <ChevronDown size={16} className={props.modelAdvanced ? 'rotate' : ''} />
              Advanced model settings
            </span>
            <small>Base URL and temperature</small>
          </button>
          {props.modelAdvanced && (
            <div className='advanced-panel'>
              <div className='form-grid'>
                <Field label='Base URL' hint='Optional OpenAI-compatible endpoint' className='wide'>
                  <input
                    value={model.baseUrl}
                    onChange={event => setModelField('baseUrl', event.target.value)}
                    placeholder='https://api.openai.com/v1'
                  />
                </Field>
                <Field label='Temperature'>
                  <input
                    value={model.temperature}
                    onChange={event => setModelField('temperature', event.target.value)}
                    inputMode='decimal'
                  />
                </Field>
              </div>
            </div>
          )}
          <div className='test-row'>
            <TestStatus {...props.modelCheck} />
            <div className='test-actions'>
              <button
                className='ghost-button reset-form-button'
                onClick={props.resetModelForm}
                disabled={props.modelCheck.state === 'testing'}
              >
                <RefreshCw size={15} />
                Reset form
              </button>
              <button
                className='outline-button'
                onClick={props.testModel}
                disabled={props.modelCheck.state === 'testing'}
              >
                {props.modelCheck.state === 'testing' ? (
                  <RefreshCw className='spin' size={16} />
                ) : (
                  <Zap size={16} />
                )}
                Test model connection
              </button>
            </div>
          </div>
        </section>
        <section className='setup-card security-card'>
          <SectionTitle
            number='03'
            icon={<Lock size={18} />}
            title='Protect this workspace'
            subtitle='Your profiles stay in your browser, encrypted.'
          />
          <div className='security-copy'>
            <ShieldCheck size={20} />
            <div>
              <strong>Local encrypted vault</strong>
              <p>
                Credentials are encrypted with your passphrase before they are saved. The unlocked
                values are kept in memory only.
              </p>
            </div>
          </div>
          <Field
            label='Vault passphrase'
            required
            hint='You will need this to unlock the workspace on your next visit'
            className='wide'
          >
            <input
              type='password'
              value={props.passphrase}
              onChange={event => props.setPassphrase(event.target.value)}
              placeholder='Create a strong passphrase'
            />
          </Field>
          <div className='save-row'>
            <div>
              <span className='save-check'>
                <Check size={14} />
              </span>
              <span>Approval required before every query</span>
            </div>
            <button
              className='primary-button'
              onClick={props.saveWorkspace}
              disabled={
                !props.passphrase ||
                props.dbCheck.state !== 'success' ||
                props.modelCheck.state !== 'success'
              }
            >
              Save and open workspace
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </div>
      <footer className='page-footer'>
        <span>
          <Lock size={13} />
          Database credentials never enter model prompts
        </span>
        <span>
          <ShieldCheck size={13} />
          Read-only execution by design
        </span>
      </footer>
    </main>
  );
}

function ChatScreen({
  profiles,
  messages,
  threads,
  activeThreadId,
  question,
  setQuestion,
  busy,
  scrollRef,
  submitQuestion,
  resume,
  startNewThread,
  selectThread,
  renameThread,
  requestDeleteThread,
  lockWorkspace,
  clearWorkspace,
}: {
  profiles: StoredProfiles;
  messages: ChatMessage[];
  threads: ChatThread[];
  activeThreadId: string;
  question: string;
  setQuestion: (value: string) => void;
  busy: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  submitQuestion: () => void;
  resume: (assistantId: string, decision: 'approve' | 'reject' | 'edit', sql?: string) => void;
  startNewThread: () => void;
  selectThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
  requestDeleteThread: (id: string) => void;
  lockWorkspace: () => void;
  clearWorkspace: () => void;
}) {
  return (
    <main className='chat-page'>
      <header className='chat-topbar'>
        <div className='brand'>
          <div className='brand-mark'>
            <Sparkles size={18} />
          </div>
          <div>
            <span className='brand-name'>Queryroom</span>
            <span className='brand-subtitle'>Read-only data intelligence</span>
          </div>
        </div>
        <div className='connection-summary'>
          <span className='status-dot' />
          <span>{profiles.connection.name}</span>
          <span className='summary-divider' />
          <span>{profiles.connection.dialect}</span>
        </div>
        <div className='top-actions'>
          <button className='ghost-button' onClick={lockWorkspace}>
            <Lock size={15} />
            Lock vault
          </button>
          <button
            className='icon-button danger-icon-button'
            onClick={clearWorkspace}
            aria-label='Clear workspace'
            title='Clear workspace'
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>
      <div className='chat-layout'>
        <aside className='sidebar'>
          <div className='sidebar-heading'>
            <div className='sidebar-label'>Workspace</div>
            {threads.length > 0 && (
              <button
                className='new-thread-button'
                onClick={startNewThread}
                disabled={busy}
                aria-label='Start new conversation'
                title='Start new conversation'
              >
                <Plus size={15} />
              </button>
            )}
          </div>
          {threads.length === 0 ? (
            <button className='sidebar-item active' onClick={startNewThread} disabled={busy}>
              <MessageSquare size={16} />
              <span>New conversation</span>
              <span className='live-dot' />
            </button>
          ) : (
            <>
              <div className='sidebar-label history-label'>Recent</div>
              <div className='thread-list'>
                {threads.map(thread => (
                  <ChatThreadItem
                    key={thread.id}
                    thread={thread}
                    active={thread.id === activeThreadId}
                    disabled={busy}
                    select={selectThread}
                    rename={renameThread}
                    requestDelete={requestDeleteThread}
                  />
                ))}
              </div>
            </>
          )}
          <div className='sidebar-bottom'>
            <div className='mini-health'>
              <span className='status-dot' />
              <div>
                <strong>Database healthy</strong>
                <small>{profiles.connection.dialect} · read-only</small>
              </div>
            </div>
            <div className='mini-health'>
              <span className='status-dot' />
              <div>
                <strong>Model connected</strong>
                <small>{profiles.model.model}</small>
              </div>
            </div>
          </div>
        </aside>
        <section className='conversation'>
          <div className='conversation-header'>
            <div>
              <p className='eyebrow'>Live query room</p>
              <h1>Ask your data.</h1>
            </div>
            <div className='hitl-indicator'>
              <ShieldCheck size={15} />
              Human approval on
            </div>
          </div>
          <div className='messages' ref={scrollRef}>
            {messages.map(message => (
              <Message key={message.id} message={message} resume={resume} busy={busy} />
            ))}
          </div>
          <div className='composer-wrap'>
            <div className='composer'>
              <textarea
                value={question}
                onChange={event => setQuestion(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitQuestion();
                  }
                }}
                placeholder='Ask a question about your connected database…'
                rows={2}
                maxLength={20000}
                disabled={busy}
              />
              <button
                className='send-button'
                onClick={submitQuestion}
                disabled={busy || !question.trim()}
                aria-label='Send question'
              >
                {busy ? <RefreshCw className='spin' size={18} /> : <Send size={18} />}
              </button>
            </div>
            <div className='composer-footer'>
              <span>
                <Terminal size={13} />
                Shift + Enter for a new line
              </span>
              <span>
                <Lock size={13} />
                Queries are read-only
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function ChatThreadItem({
  thread,
  active,
  disabled,
  select,
  rename,
  requestDelete,
}: {
  thread: ChatThread;
  active: boolean;
  disabled: boolean;
  select: (id: string) => void;
  rename: (id: string, title: string) => void;
  requestDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);

  if (editing)
    return (
      <form
        className='thread-edit-form'
        onSubmit={event => {
          event.preventDefault();
          rename(thread.id, draft);
          setEditing(false);
        }}
      >
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          aria-label='Conversation name'
          autoFocus
        />
        <button type='submit' className='thread-action' aria-label='Save conversation name'>
          <Check size={14} />
        </button>
        <button
          type='button'
          className='thread-action'
          onClick={() => setEditing(false)}
          aria-label='Cancel rename'
        >
          <X size={14} />
        </button>
      </form>
    );

  return (
    <div className={`thread-item ${active ? 'active' : ''}`}>
      <button
        className='thread-select'
        onClick={() => select(thread.id)}
        disabled={disabled}
        title={thread.title}
      >
        <MessageSquare size={15} />
        <span className='thread-copy'>
          <strong>{thread.title}</strong>
          <small>
            {thread.messages.filter(message => message.role === 'user').length} questions
          </small>
        </span>
      </button>
      <div className='thread-actions'>
        <button
          className='thread-action'
          onClick={() => {
            setDraft(thread.title);
            setEditing(true);
          }}
          disabled={disabled}
          aria-label={`Rename ${thread.title}`}
          title='Rename conversation'
        >
          <Pencil size={13} />
        </button>
        <button
          className='thread-action delete-thread-action'
          onClick={() => requestDelete(thread.id)}
          disabled={disabled}
          aria-label={`Delete ${thread.title}`}
          title='Delete conversation'
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function Message({
  message,
  resume,
  busy,
}: {
  message: ChatMessage;
  resume: (assistantId: string, decision: 'approve' | 'reject' | 'edit', sql?: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editedSql, setEditedSql] = useState(message.approval?.sql ?? '');
  const [promptCopied, setPromptCopied] = useState(false);

  const copyPrompt = async () => {
    if (!message.text || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 1600);
    } catch {
      setPromptCopied(false);
    }
  };

  if (message.role === 'user')
    return (
      <div className='message user-message'>
        <div className='message-avatar'>You</div>
        <div className='user-prompt-group'>
          <div className='message-bubble'>{message.text}</div>
          <button
            className='message-copy-button'
            onClick={copyPrompt}
            aria-label={promptCopied ? 'Prompt copied' : 'Copy user prompt'}
            title={promptCopied ? 'Prompt copied' : 'Copy user prompt'}
          >
            {promptCopied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
    );
  return (
    <div className='message assistant-message'>
      <div className='message-avatar assistant-avatar'>
        <Sparkles size={15} />
      </div>
      <div className='assistant-content'>
        {message.running && (
          <StageTimeline stages={message.stages ?? []} current={message.currentStage} />
        )}
        {message.text && (
          <p className={message.rejected ? 'assistant-error' : ''}>
            {message.rejected && <CircleAlert size={15} />}
            {message.text}
          </p>
        )}
        {message.approval && (
          <div className='approval-card'>
            <div className='approval-head'>
              <div>
                <span className='approval-kicker'>
                  <ShieldCheck size={14} />
                  Human approval required
                </span>
                <h3>Review before this query runs</h3>
              </div>
              <span className='approval-badge'>Read only</span>
            </div>
            <div className='approval-question'>
              The agent wants to answer: <strong>{message.approval.explanation}</strong>
            </div>
            <div className='sql-block'>
              <div className='code-head'>
                <span>
                  <Terminal size={14} />
                  Generated SQL
                </span>
                <button
                  className='icon-button'
                  aria-label='Copy SQL'
                  onClick={() => navigator.clipboard?.writeText(message.approval?.sql ?? '')}
                >
                  <Copy size={14} />
                </button>
              </div>
              {editing ? (
                <textarea
                  value={editedSql}
                  onChange={event => setEditedSql(event.target.value)}
                  rows={6}
                />
              ) : (
                <code>{message.approval.sql}</code>
              )}
            </div>
            <div className='approval-meta'>
              <span>Tables: {message.approval.tables.join(', ') || 'verified schema'}</span>
              <span>{message.approval.checks.length} safety checks passed</span>
            </div>
            <div className='approval-actions'>
              {editing ? (
                <>
                  <button
                    className='primary-button'
                    onClick={() => {
                      setEditing(false);
                      resume(message.id, 'edit', editedSql);
                    }}
                    disabled={busy}
                  >
                    <Check size={15} />
                    Re-check and review
                  </button>
                  <button className='ghost-button' onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    className='primary-button'
                    onClick={() => resume(message.id, 'approve')}
                    disabled={busy}
                  >
                    <Check size={15} />
                    Approve and run
                  </button>
                  <button
                    className='outline-button'
                    onClick={() => {
                      setEditedSql(message.approval?.sql ?? '');
                      setEditing(true);
                    }}
                    disabled={busy}
                  >
                    <Terminal size={15} />
                    Edit SQL
                  </button>
                  <button
                    className='danger-button'
                    onClick={() => resume(message.id, 'reject')}
                    disabled={busy}
                  >
                    <X size={15} />
                    Reject
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {message.result && <ResultCard result={message.result} sql={message.sql} />}
      </div>
    </div>
  );
}
function StageTimeline({ stages, current }: { stages: string[]; current?: string }) {
  const unique = [...new Set(stages)];
  return (
    <div className='stage-timeline'>
      {unique.map(stage => (
        <div className='stage-row' key={stage}>
          <span className='stage-icon'>
            <Check size={12} />
          </span>
          <span>{stage}</span>
        </div>
      ))}
      {current && (
        <div className='stage-row active-stage'>
          <span className='stage-spinner'>
            <RefreshCw size={12} />
          </span>
          <span>
            {current}
            <i className='ellipsis'>…</i>
          </span>
        </div>
      )}
    </div>
  );
}
function ResultCard({ result, sql }: { result: QueryResult; sql?: string }) {
  const [tab, setTab] = useState<'table' | 'details'>('table');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState<'data' | 'query' | null>(null);
  const copy = async (kind: 'data' | 'query', value: string) => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };
  const copyableData = JSON.stringify(result.rows, null, 2);
  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isFullscreen]);
  const card = (
    <div
      className={`result-card ${isFullscreen ? 'fullscreen-result-card' : ''}`}
      onClick={event => event.stopPropagation()}
    >
      <div className='result-head'>
        <div>
          <span className='result-kicker'>
            <CircleCheck size={14} />
            Query complete
          </span>
          <h3>
            {result.rowCount
              ? `Returned ${result.rowCount} row${result.rowCount === 1 ? '' : 's'}`
              : 'No rows found'}
          </h3>
        </div>
        <div className='export-actions'>
          <button className='export-button' onClick={() => exportCsv(result)}>
            <FileText size={14} />
            CSV
          </button>
          <button className='export-button' onClick={() => exportJson(result)}>
            <FileJson size={14} />
            JSON
          </button>
          <button
            className='export-button'
            onClick={async () => {
              setExporting(true);
              await exportXlsx(result);
              setExporting(false);
            }}
            disabled={exporting}
          >
            <FileSpreadsheet size={14} />
            {exporting ? '…' : 'XLSX'}
          </button>
        </div>
      </div>
      <div className='result-tabs'>
        <button className={tab === 'table' ? 'active' : ''} onClick={() => setTab('table')}>
          <Table2 size={14} />
          Data
        </button>
        <button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>
          <Terminal size={14} />
          Query details
        </button>
      </div>
      {tab === 'table' ? (
        <>
          <div className='data-toolbar'>
            <span>
              <Table2 size={13} />
              Result
            </span>
            <div className='data-toolbar-actions'>
              <button
                className='export-button'
                onClick={() => copy('data', copyableData)}
                disabled={!result.columns.length}
                title='Copy displayed rows as JSON'
              >
                {copied === 'data' ? <Check size={14} /> : <Copy size={14} />}
                {copied === 'data' ? 'Copied' : 'Copy'}
              </button>
              <button
                className='icon-button fullscreen-button'
                onClick={() => setIsFullscreen(current => !current)}
                aria-label={isFullscreen ? 'Exit fullscreen table' : 'Open table fullscreen'}
                title={isFullscreen ? 'Exit fullscreen table' : 'Open table fullscreen'}
              >
                {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            </div>
          </div>
          <div className='table-scroll'>
            <table>
              <thead>
                <tr>
                  {result.columns.map(column => (
                    <th key={column.name} title={column.name}>
                      <span className='cell-value'>{column.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {result.columns.map(column => {
                      const value = formatCell(row[column.name]);
                      return (
                        <td key={column.name} title={value}>
                          <span className='cell-value'>{value}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.truncated && (
              <div className='truncated-note'>
                <CircleAlert size={14} />
                Showing the configured result limit. Refine your question for a smaller result.
              </div>
            )}
          </div>
        </>
      ) : (
        <div className='query-details'>
          <div className='metadata-grid'>
            <span>
              Rows returned<strong>{result.rowCount}</strong>
            </span>
            <span>
              Duration<strong>{result.durationMs}ms</strong>
            </span>
            <span>
              Columns<strong>{result.columns.length}</strong>
            </span>
            <span>
              Mode<strong>Read-only</strong>
            </span>
          </div>
          <div className='sql-block raw-query-block'>
            <div className='code-head'>
              <span>
                <Terminal size={14} />
                Validated read-only SQL
              </span>
              <div className='code-actions'>
                <button
                  className='icon-button'
                  aria-label='Copy raw query'
                  onClick={() => copy('query', sql ?? '')}
                  disabled={!sql}
                >
                  {copied === 'query' ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  className='icon-button fullscreen-button'
                  onClick={() => setIsFullscreen(current => !current)}
                  aria-label={
                    isFullscreen ? 'Exit fullscreen query details' : 'Open query details fullscreen'
                  }
                  title={
                    isFullscreen ? 'Exit fullscreen query details' : 'Open query details fullscreen'
                  }
                >
                  {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              </div>
            </div>
            <pre>{sql || 'The raw query is not available for this result.'}</pre>
          </div>
        </div>
      )}
    </div>
  );
  return isFullscreen ? (
    <div className='table-fullscreen-backdrop' onClick={() => setIsFullscreen(false)}>
      {card}
    </div>
  ) : (
    card
  );
}
function SectionTitle({
  number,
  icon,
  title,
  subtitle,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className='section-title'>
      <span className='section-number'>{number}</span>
      <span className='section-icon'>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
function Field({
  label,
  hint,
  required,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`field ${className}`}>
      <span className='field-label'>
        {label}
        {required && <em>*</em>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function TestStatus({
  state,
  message,
  details,
}: {
  state: CheckState;
  message?: string;
  details?: string;
}) {
  if (state === 'idle')
    return (
      <span className='test-help'>
        <Zap size={14} />
        Run a test before saving
      </span>
    );
  if (state === 'testing')
    return (
      <span className='test-status testing'>
        <RefreshCw className='spin' size={14} />
        Testing connection
      </span>
    );
  if (state === 'success')
    return (
      <span className='test-status success'>
        <CircleCheck size={15} />
        <span>
          <strong>{message}</strong>
          <small>{details}</small>
        </span>
      </span>
    );
  return (
    <span className='test-status error' role='alert'>
      <CircleAlert size={15} />
      <span>
        <strong>{message}</strong>
        <small>Nothing was saved</small>
      </span>
    </span>
  );
}
