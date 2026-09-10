import { Check, MessageSquare, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { ChatThread } from '../types';

export default function ChatThreadItem({
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
