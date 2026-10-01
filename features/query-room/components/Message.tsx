import { AnimatePresence, motion } from 'motion/react';
import dynamic from 'next/dynamic';
import { Check, CircleAlert, Copy, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { Approval, ChatMessage } from '../types';
import { useCopy } from '../useCopy';
import SqlCode from './SqlCode';
import SqlEditor from './SqlEditor';

const ResultCard = dynamic(() => import('./ResultCard'));

type Resume = (assistantId: string, decision: 'approve' | 'reject' | 'edit', sql?: string) => void;

const EASE = [0.22, 1, 0.36, 1] as const;
const appear = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, ease: EASE },
};

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
      <motion.div className='msg msg-user' {...appear}>
        <div className='msg-bubble'>{message.text}</div>
        <MessageActions text={message.text} />
      </motion.div>
    );

  return (
    <motion.div className='msg' {...appear}>
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
      <AnimatePresence>
        {message.approval && (
          <ApprovalCard
            key={`${message.approval.runId}-${message.approval.sql}`}
            messageId={message.id}
            approval={message.approval}
            resume={resume}
            busy={busy}
          />
        )}
      </AnimatePresence>
      {message.result && (
        <motion.div {...appear}>
          <ResultCard result={message.result} sql={message.sql} />
        </motion.div>
      )}
      {message.text && !message.running && <MessageActions text={message.text} />}
    </motion.div>
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
        <motion.div
          className='progress-row done'
          key={stage}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <Check size={14} />
          {stage}
        </motion.div>
      ))}
      {current && (
        <motion.div
          className='progress-row current'
          key={current}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <LoaderCircle className='spin' size={14} />
          {current}…
        </motion.div>
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

  const recheck = () => {
    if (busy || !editedSql.trim()) return;
    setEditing(false);
    resume(messageId, 'edit', editedSql);
  };

  return (
    <motion.section
      className='card approval-card'
      style={{ overflow: 'hidden' }}
      aria-label='Query approval'
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
    >
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
          <SqlEditor
            value={editedSql}
            onChange={setEditedSql}
            onSubmit={recheck}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <SqlCode sql={approval.sql} />
        )}
        {hasErrors ? (
          <motion.div
            className='callout-error approval-errors'
            role='alert'
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <CircleAlert size={15} />
            <div>
              This SQL can’t run yet:
              <ul>
                {approval.errors.map(error => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
              Edit the SQL to fix it, or reject it.
            </div>
          </motion.div>
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
              onClick={recheck}
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
    </motion.section>
  );
}
