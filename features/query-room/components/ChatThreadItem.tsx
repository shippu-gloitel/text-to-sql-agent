import { Check, Pencil, Trash2, X } from 'lucide-react';
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
        className='thread-edit'
        onSubmit={event => {
          event.preventDefault();
          rename(thread.id, draft);
          setEditing(false);
        }}
      >
        <input
          className='input'
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => event.key === 'Escape' && setEditing(false)}
          aria-label='Conversation name'
          autoFocus
        />
        <button type='submit' className='icon-btn' aria-label='Save name'>
          <Check size={14} />
        </button>
        <button
          type='button'
          className='icon-btn'
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
        aria-current={active ? 'page' : undefined}
      >
        {thread.title}
      </button>
      <div className='thread-actions'>
        <button
          className='icon-btn'
          onClick={() => {
            setDraft(thread.title);
            setEditing(true);
          }}
          disabled={disabled}
          aria-label={`Rename ${thread.title}`}
          title='Rename'
        >
          <Pencil size={13} />
        </button>
        <button
          className='icon-btn danger'
          onClick={() => requestDelete(thread.id)}
          disabled={disabled}
          aria-label={`Delete ${thread.title}`}
          title='Delete'
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
