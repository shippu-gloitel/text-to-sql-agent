import dynamic from 'next/dynamic';
import {
  Check,
  CircleAlert,
  Copy,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import type { ChatMessage } from '../types';

const ResultCard = dynamic(() => import('./ResultCard'));

export default function Message({
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
