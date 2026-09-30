'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  decryptSessionVault,
  decryptVault,
  encryptSessionVault,
  encryptVault,
  generateDataKey,
  vaultNeedsUpgrade,
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
import type { StreamEvent } from '@/lib/types';
import type { ChatMessage, ChatThread, StoredProfiles, CheckState, Theme } from './types';
import {
  consumeStream,
  friendlyTestError,
  initialModel,
  initialSetup,
  makeConnection,
  loadThreads,
  makeModel,
  saveThreads,
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [question, setQuestion] = useState('');
  const [threadId, setThreadId] = useState('');
  const [busy, setBusy] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [threadDeleteTarget, setThreadDeleteTarget] = useState<ChatThread | null>(null);
  // The inline script in the root layout applies the saved theme before hydration.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light'
      ? 'light'
      : 'dark',
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const toggleTheme = () => setTheme(current => (current === 'dark' ? 'light' : 'dark'));

  const applyProfiles = useCallback(async (value: StoredProfiles & { threadsKey: string }) => {
    const savedThreads = await loadThreads(value.threadsKey);
    const activeThread = [...savedThreads].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    setThreads(savedThreads);
    setThreadId(activeThread?.id ?? `thread-${crypto.randomUUID()}`);
    setMessages(activeThread?.messages ?? []);
    setProfiles(value);
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
            // Workspaces saved before chat history was encrypted must be unlocked once to upgrade.
            if (!restored.threadsKey) clearSessionVault();
            else if (!cancelled)
              await applyProfiles({ ...restored, threadsKey: restored.threadsKey });
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
    try {
      window.localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // Local storage may be disabled by the browser.
    }
  }, [theme]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const threadsKey = profiles?.threadsKey;
    if (!threadsKey) return;
    // Debounced so a streaming answer does not re-encrypt history on every event.
    const timer = window.setTimeout(() => void saveThreads(threads, threadsKey), 400);
    return () => window.clearTimeout(timer);
  }, [profiles, threads]);

  useEffect(() => {
    if (!profiles || !threadId || !messages.some(message => message.role === 'user')) return;
    setThreads(current => {
      const existing = current.find(thread => thread.id === threadId);
      // Selecting a thread restores its saved messages; that is not a new update.
      if (existing?.messages === messages) return current;
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
      const value = { ...restored, threadsKey: restored.threadsKey ?? generateDataKey() };
      if (!restored.threadsKey || vaultNeedsUpgrade(vault)) {
        // Re-encrypt older vaults with the current key-derivation strength and a history key.
        const upgraded = await encryptVault(value, passphrase);
        writeStorage(STORAGE_KEYS.vault, upgraded);
        setVault(upgraded);
      }
      writeSessionVault(await encryptSessionVault(value));
      await applyProfiles(value);
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
      const value = {
        connection: makeConnection(setup),
        model: makeModel(modelForm),
        threadsKey: generateDataKey(),
      };
      const encrypted = await encryptVault(value, passphrase);
      writeStorage(STORAGE_KEYS.vault, encrypted);
      writeSessionVault(await encryptSessionVault(value));
      setVault(encrypted);
      await applyProfiles(value);
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
    setThreads([]);
    setMessages([]);
    setDbCheck({ state: 'idle' });
    setModelCheck({ state: 'idle' });
  };

  const lockWorkspace = () => {
    abortRef.current?.abort();
    clearSessionVault();
    setProfiles(null);
    setPassphrase('');
  };

  const startNewThread = () => {
    if (busy) return;
    // The conversation is added to the list once its first question is asked.
    setThreadId(`thread-${crypto.randomUUID()}`);
    setMessages([]);
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
      setMessages([]);
      setQuestion('');
    }
    setThreadDeleteTarget(null);
  };

  const handleStreamEvent = (assistantId: string, event: StreamEvent) => {
    const update = (patch: Parameters<typeof updateMessage>[2]) =>
      setMessages(current => updateMessage(current, assistantId, patch));

    switch (event.type) {
      case 'stage.started':
        setMessages(current =>
          updateMessage(current, assistantId, {
            currentStage: event.stage,
            stages: [...(current.find(item => item.id === assistantId)?.stages ?? []), event.stage],
          }),
        );
        break;
      case 'sql.ready':
        update({ sql: event.sql });
        break;
      case 'approval.required':
        update({
          approval: {
            runId: event.runId,
            sql: event.sql,
            explanation: event.explanation,
            tables: event.tables ?? [],
            checks: event.checks ?? [],
            errors: event.errors ?? [],
          },
          sql: event.errors?.length ? undefined : event.sql,
          running: false,
          currentStage: 'Waiting for approval',
        });
        break;
      case 'result.completed':
        update({ result: event.result, currentStage: 'Results ready', running: false });
        break;
      case 'run.completed':
        update({ text: event.answer, running: false, currentStage: undefined });
        break;
      case 'run.error':
        update({ text: event.message, running: false, rejected: true, currentStage: undefined });
        break;
    }
  };

  const streamRun = async (url: string, body: unknown, assistantId: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await consumeStream(
        url,
        body,
        event => handleStreamEvent(assistantId, event),
        controller.signal,
      );
    } catch (error) {
      const stopped = controller.signal.aborted;
      setMessages(current =>
        updateMessage(current, assistantId, {
          text: stopped
            ? 'Stopped. Nothing further will run for this request.'
            : error instanceof Error
              ? error.message
              : 'The stream ended unexpectedly.',
          running: false,
          rejected: !stopped,
          stopped,
          currentStage: undefined,
        }),
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const stopRun = () => abortRef.current?.abort();

  const submitQuestion = async (text = question) => {
    const userText = text.trim();
    if (!profiles || !threadId || !userText || busy) return;
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
    const runId = messages.find(message => message.id === assistantId)?.approval?.runId;
    if (!profiles || !threadId || !runId || busy) return;
    setBusy(true);
    setMessages(current =>
      updateMessage(current, assistantId, {
        approval: undefined,
        text: undefined,
        rejected: false,
        running: decision !== 'reject',
        currentStage:
          decision === 'reject'
            ? undefined
            : decision === 'edit'
              ? 'Checking edited SQL'
              : 'Executing approved query',
      }),
    );

    await streamRun('/api/agent/resume', { threadId, runId, decision, sql }, assistantId);
  };
  if (!hydrated) return <div className='loading'>Loading…</div>;

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
        stopRun={stopRun}
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
