'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  readSessionVault,
  readVault,
  writeSessionVault,
  writeStorage,
  STORAGE_KEYS,
} from '@/lib/storage';
import type { QueryResult } from '@/lib/types';
import type { ChatMessage, ChatThread, StoredProfiles, CheckState, Theme } from './types';
import {
  consumeStream,
  defaultMessage,
  friendlyTestError,
  initialModel,
  initialSetup,
  makeConnection,
  makeModel,
  readThreads,
  threadTitle,
  updateMessage,
} from './utils';
import { DeleteThreadModal, DeleteWorkspaceModal } from './components/WorkspaceModals';

const ChatScreen = dynamic(() => import('./components/ChatScreen'));
const SetupScreen = dynamic(() => import('./components/SetupScreen'));
const UnlockScreen = dynamic(() => import('./components/UnlockScreen'));

export default function QueryRoom() {
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
  const [theme, setTheme] = useState<Theme>('dark');
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggleTheme = () => setTheme(current => (current === 'dark' ? 'light' : 'dark'));

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
      const savedTheme = window.localStorage.getItem('queryroom.theme');
      if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
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
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('queryroom.theme', theme);
  }, [theme]);

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
        theme={theme}
        toggleTheme={toggleTheme}
        passphrase={passphrase}
        setPassphrase={setPassphrase}
        unlock={unlock}
        clearWorkspace={requestClearWorkspace}
        error={unlockError}
      />
    ) : profiles ? (
      <ChatScreen
        theme={theme}
        toggleTheme={toggleTheme}
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
        theme={theme}
        toggleTheme={toggleTheme}
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
