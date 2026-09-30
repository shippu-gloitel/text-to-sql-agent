import { ArrowUp, Database, Lock, Menu, Plus, ShieldCheck, Square, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ChatMessage, ChatThread, StoredProfiles, Theme } from '../types';
import ChatThreadItem from './ChatThreadItem';
import Logo from './Logo';
import Message from './Message';
import ThemeToggle from './ThemeToggle';

const DIALECT_LABELS = { postgresql: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite' } as const;

const SUGGESTIONS = [
  'Which tables are available?',
  'How many rows are in each table?',
  'How are the tables related to each other?',
  'Show 10 sample rows from the largest table',
];

export default function ChatScreen({
  theme,
  toggleTheme,
  profiles,
  messages,
  threads,
  activeThreadId,
  question,
  setQuestion,
  busy,
  scrollRef,
  submitQuestion,
  stopRun,
  resume,
  startNewThread,
  selectThread,
  renameThread,
  requestDeleteThread,
  lockWorkspace,
  clearWorkspace,
}: {
  theme: Theme;
  toggleTheme: () => void;
  profiles: StoredProfiles;
  messages: ChatMessage[];
  threads: ChatThread[];
  activeThreadId: string;
  question: string;
  setQuestion: (value: string) => void;
  busy: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  submitQuestion: (text?: string) => void;
  stopRun: () => void;
  resume: (assistantId: string, decision: 'approve' | 'reject' | 'edit', sql?: string) => void;
  startNewThread: () => void;
  selectThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
  requestDeleteThread: (id: string) => void;
  lockWorkspace: () => void;
  clearWorkspace: () => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const { connection, model } = profiles;
  const title = threads.find(thread => thread.id === activeThreadId)?.title ?? 'New conversation';
  const isEmpty = !messages.some(message => message.role === 'user');

  // Grow the composer with its content, up to the CSS max-height.
  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [question]);

  useEffect(() => {
    if (!busy) composerRef.current?.focus();
  }, [busy, activeThreadId]);

  return (
    <div className='app'>
      <div
        className='sidebar-overlay'
        data-open={sidebarOpen}
        onClick={() => setSidebarOpen(false)}
        aria-hidden='true'
      />
      <aside className='sidebar' data-open={sidebarOpen} aria-label='Conversations'>
        <div className='sidebar-top'>
          <div className='sidebar-brand'>
            <Logo />
            <button
              className='icon-btn sidebar-close'
              onClick={() => setSidebarOpen(false)}
              aria-label='Close sidebar'
            >
              <X size={16} />
            </button>
          </div>
          <button
            className='btn btn-secondary btn-block'
            onClick={() => {
              startNewThread();
              setSidebarOpen(false);
            }}
            disabled={busy}
          >
            <Plus size={15} />
            New conversation
          </button>
        </div>
        <div className='sidebar-section'>Conversations</div>
        <nav className='thread-list'>
          {threads.length === 0 ? (
            <p className='thread-empty'>Your conversations will appear here.</p>
          ) : (
            threads.map(thread => (
              <ChatThreadItem
                key={thread.id}
                thread={thread}
                active={thread.id === activeThreadId}
                disabled={busy}
                select={id => {
                  selectThread(id);
                  setSidebarOpen(false);
                }}
                rename={renameThread}
                requestDelete={requestDeleteThread}
              />
            ))
          )}
        </nav>
        <div className='sidebar-footer'>
          <div className='connection' title={connection.description || connection.name}>
            <span className='connection-icon'>
              <Database size={14} />
            </span>
            <span>
              <strong>{connection.name}</strong>
              <small>
                {DIALECT_LABELS[connection.dialect]} · {model.model}
              </small>
            </span>
          </div>
          <div className='sidebar-actions'>
            <ThemeToggle theme={theme} toggle={toggleTheme} />
            <button
              className='icon-btn'
              onClick={lockWorkspace}
              aria-label='Lock workspace'
              title='Lock workspace'
            >
              <Lock size={16} />
            </button>
            <button
              className='icon-btn danger'
              onClick={clearWorkspace}
              aria-label='Clear workspace'
              title='Clear workspace'
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className='main'>
        <header className='main-header'>
          <button
            className='icon-btn menu-btn'
            onClick={() => setSidebarOpen(true)}
            aria-label='Open sidebar'
          >
            <Menu size={17} />
          </button>
          <h1>{title}</h1>
          <span
            className='main-header-meta'
            title='Every query needs your approval and runs read-only'
          >
            <ShieldCheck size={14} />
            <span>Read-only · approval required</span>
          </span>
        </header>

        <div className='messages' ref={scrollRef}>
          <div className='messages-inner'>
            {isEmpty ? (
              <div className='empty-state'>
                <div>
                  <h2>Ask about {connection.name}</h2>
                  <p>
                    Ask in plain language or paste a SELECT query. You&apos;ll review the SQL before
                    anything runs.
                  </p>
                </div>
                <div className='suggestions'>
                  {SUGGESTIONS.map(suggestion => (
                    <button
                      key={suggestion}
                      onClick={() => submitQuestion(suggestion)}
                      disabled={busy}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map(message => (
                <Message key={message.id} message={message} resume={resume} busy={busy} />
              ))
            )}
          </div>
        </div>

        <div className='composer-area'>
          <form
            className='composer'
            onSubmit={event => {
              event.preventDefault();
              submitQuestion();
            }}
          >
            <textarea
              ref={composerRef}
              value={question}
              onChange={event => setQuestion(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submitQuestion();
                }
              }}
              placeholder='Ask a question or paste a SELECT query…'
              aria-label='Question'
              rows={1}
              maxLength={20000}
              disabled={busy}
            />
            {busy ? (
              <button
                type='button'
                className='send-btn'
                onClick={stopRun}
                aria-label='Stop the running request'
                title='Stop'
              >
                <Square size={12} fill='currentColor' />
              </button>
            ) : (
              <button
                type='submit'
                className='send-btn'
                disabled={!question.trim()}
                aria-label='Send question'
                title='Send'
              >
                <ArrowUp size={16} />
              </button>
            )}
          </form>
          <p className='composer-hint'>
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
          </p>
        </div>
      </main>
    </div>
  );
}
