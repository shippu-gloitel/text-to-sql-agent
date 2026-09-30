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
import type { Approval, ChatMessage } from '../types';

const ResultCard = dynamic(() => import('./ResultCard'));

type Resume = (assistantId: string, decision: 'approve' | 'reject' | 'edit', sql?: string) => void;

export default function Message({
  message,
  resume,
  busy,
}: {
  message: ChatMessage;
  resume: Resume;
  busy: boolean;
}) {
  const [messageCopied, setMessageCopied] = useState(false);

  const copyMessage = async () => {
    if (!message.text || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setMessageCopied(true);
      window.setTimeout(() => setMessageCopied(false), 1600);
    } catch {
      setMessageCopied(false);
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
            onClick={copyMessage}
            aria-label={messageCopied ? 'Message copied' : 'Copy user prompt'}
            title={messageCopied ? 'Message copied' : 'Copy user prompt'}
          >
            {messageCopied ? <Check size={14} /> : <Copy size={14} />}
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
          <div className='assistant-text-group'>
            <p className={message.rejected ? 'assistant-error' : ''}>
              {message.rejected && <CircleAlert size={15} />}
              {message.text}
            </p>
            <button
              className='message-copy-button'
              onClick={copyMessage}
              aria-label={messageCopied ? 'Message copied' : 'Copy agent response'}
              title={messageCopied ? 'Message copied' : 'Copy agent response'}
            >
              {messageCopied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}

        {message.approval && (
          <ApprovalCard
            messageId={message.id}
            approval={message.approval}
            resume={resume}
            busy={busy}
          />
        )}
        {message.result && <ResultCard result={message.result} sql={message.sql} />}
      </div>
    </div>
  );
}

function ApprovalCard({
  messageId,
  approval,
  resume,
  busy,
}: {
  messageId: string;
  approval: Approval;
  resume: Resume;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editedSql, setEditedSql] = useState(approval.sql);

  return (
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
        The agent wants to answer: <strong>{approval.explanation}</strong>
      </div>
      <div className='sql-block'>
        <div className='code-head'>
          <span>
            <Terminal size={14} />
            {approval.errors.length ? 'Edited SQL' : 'Generated SQL'}
          </span>
          <button
            className='icon-button'
            aria-label='Copy SQL'
            onClick={() => navigator.clipboard?.writeText(approval.sql ?? '')}
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
          <code>{approval.sql}</code>
        )}
      </div>
      {approval.errors.length > 0 ? (
        <div className='approval-errors' role='alert'>
          <CircleAlert size={15} />
          <div>
            <strong>The edited SQL did not pass the safety check.</strong>
            <ul>
              {approval.errors.map(error => (
                <li key={error}>{error}</li>
              ))}
            </ul>
            Edit the SQL again to fix it, or reject this query.
          </div>
        </div>
      ) : (
        <div className='approval-meta'>
          <span>Tables: {approval.tables.join(', ') || 'verified schema'}</span>
          <span>{approval.checks.length} safety checks passed</span>
        </div>
      )}
      <div className='approval-actions'>
        {editing ? (
          <>
            <button
              className='primary-button'
              onClick={() => {
                setEditing(false);
                resume(messageId, 'edit', editedSql);
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
              onClick={() => resume(messageId, 'approve')}
              disabled={busy || approval.errors.length > 0}
            >
              <Check size={15} />
              Approve and run
            </button>
            <button
              className='outline-button'
              onClick={() => {
                setEditedSql(approval.sql ?? '');
                setEditing(true);
              }}
              disabled={busy}
            >
              <Terminal size={15} />
              Edit SQL
            </button>
            <button
              className='danger-button'
              onClick={() => resume(messageId, 'reject')}
              disabled={busy}
            >
              <X size={15} />
              Reject
            </button>
          </>
        )}
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
