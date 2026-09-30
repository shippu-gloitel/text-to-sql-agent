import dynamic from 'next/dynamic';
import { Check, CircleAlert, Copy, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { Approval, ChatMessage } from '../types';
import { useCopy } from '../useCopy';
import SqlCode from './SqlCode';

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
  if (message.role === 'user')
    return (
      <div className='msg msg-user'>
        <div className='msg-bubble'>{message.text}</div>
        <MessageActions text={message.text} />
      </div>
    );

  return (
    <div className='msg'>
      {message.running && <Progress stages={message.stages ?? []} current={message.currentStage} />}
      {message.text &&
        (message.rejected ? (
          <div className='msg-error' role='alert'>
            <CircleAlert size={15} />
            <span>{message.text}</span>
          </div>
        ) : (
          <div className={`msg-text ${message.stopped ? 'stopped' : ''}`}>{message.text}</div>
        ))}
      {message.approval && (
        <ApprovalCard
          messageId={message.id}
          approval={message.approval}
          resume={resume}
          busy={busy}
        />
      )}
      {message.result && <ResultCard result={message.result} sql={message.sql} />}
      {message.text && !message.running && <MessageActions text={message.text} />}
    </div>
  );
}

function MessageActions({ text }: { text?: string }) {
  const [copied, copy] = useCopy();
  if (!text) return null;
  return (
    <div className='msg-actions'>
      <button
        className='icon-btn'
        onClick={() => copy(text)}
        aria-label={copied ? 'Copied' : 'Copy message'}
        title={copied ? 'Copied' : 'Copy'}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function Progress({ stages, current }: { stages: string[]; current?: string }) {
  const done = [...new Set(stages)].filter(stage => stage !== current);
  return (
    <div className='progress' aria-live='polite'>
      {done.map(stage => (
        <div className='progress-row done' key={stage}>
          <Check size={14} />
          {stage}
        </div>
      ))}
      {current && (
        <div className='progress-row current'>
          <LoaderCircle className='spin' size={14} />
          {current}…
        </div>
      )}
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
  const [copied, copy] = useCopy();
  const hasErrors = approval.errors.length > 0;

  return (
    <section className='card approval-card' aria-label='Query approval'>
      <div className='card-header'>
        <span className='card-title'>
          <ShieldCheck size={15} />
          Review query
        </span>
        <div className='card-tools'>
          <button
            className='icon-btn'
            onClick={() => copy(approval.sql)}
            aria-label={copied ? 'SQL copied' : 'Copy SQL'}
            title={copied ? 'Copied' : 'Copy SQL'}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
      <div className='card-body'>
        {approval.explanation && <p>{approval.explanation}</p>}
        {editing ? (
          <textarea
            className='code'
            value={editedSql}
            onChange={event => setEditedSql(event.target.value)}
            aria-label='Edit SQL'
            spellCheck={false}
            autoFocus
          />
        ) : (
          <SqlCode sql={approval.sql} />
        )}
        {hasErrors ? (
          <div className='callout-error approval-errors' role='alert'>
            <CircleAlert size={15} />
            <div>
              This SQL did not pass the safety check:
              <ul>
                {approval.errors.map(error => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
              Edit it again to fix the problem, or reject it.
            </div>
          </div>
        ) : (
          approval.tables.length > 0 && (
            <div className='meta-row'>
              Reads from
              {approval.tables.map(table => (
                <span className='chip' key={table}>
                  {table}
                </span>
              ))}
            </div>
          )
        )}
      </div>
      <div className='card-footer'>
        {editing ? (
          <>
            <button
              className='btn btn-primary'
              onClick={() => {
                setEditing(false);
                resume(messageId, 'edit', editedSql);
              }}
              disabled={busy || !editedSql.trim()}
            >
              Re-check SQL
            </button>
            <button className='btn btn-ghost' onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className='btn btn-primary'
              onClick={() => resume(messageId, 'approve')}
              disabled={busy || hasErrors}
            >
              Approve and run
            </button>
            <button
              className='btn btn-secondary'
              onClick={() => {
                setEditedSql(approval.sql);
                setEditing(true);
              }}
              disabled={busy}
            >
              Edit SQL
            </button>
            <button
              className='btn btn-danger-ghost'
              onClick={() => resume(messageId, 'reject')}
              disabled={busy}
            >
              Reject
            </button>
          </>
        )}
      </div>
    </section>
  );
}
