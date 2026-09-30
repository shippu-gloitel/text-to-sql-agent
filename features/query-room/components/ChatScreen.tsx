import {
  Lock,
  MessageSquare,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import type React from 'react';
import type { ChatMessage, ChatThread, StoredProfiles, Theme } from '../types';
import ChatThreadItem from './ChatThreadItem';
import Message from './Message';
import ThemeToggle from './ThemeToggle';

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
  scrollRef: React.RefObject<HTMLDivElement | null>;
  submitQuestion: () => void;
  stopRun: () => void;
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
          <ThemeToggle theme={theme} toggle={toggleTheme} />
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
              <h1>Ask an Agent</h1>
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
              {busy ? (
                <button
                  className='send-button'
                  onClick={stopRun}
                  aria-label='Stop the running request'
                  title='Stop'
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  className='send-button'
                  onClick={submitQuestion}
                  disabled={!question.trim()}
                  aria-label='Send question'
                >
                  <Send size={18} />
                </button>
              )}
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
