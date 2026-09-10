import { useEffect, useState } from 'react';
import {
  CircleAlert,
  Database,
  KeyRound,
  Lock,
  MessageSquare,
  RefreshCw,
  Trash2,
} from 'lucide-react';

export function DeleteWorkspaceModal({
  cancel,
  confirm,
}: {
  cancel: () => void;
  confirm: (passphrase: string) => Promise<boolean>;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cancel]);

  return (
    <div className='modal-backdrop' role='presentation' onMouseDown={cancel}>
      <section
        className='confirm-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='clear-workspace-title'
        onMouseDown={event => event.stopPropagation()}
      >
        <div className='modal-icon'>
          <Trash2 size={18} />
        </div>
        <p className='eyebrow'>Local workspace</p>
        <h2 id='clear-workspace-title'>Clear this workspace?</h2>
        <p className='muted'>This permanently removes the following local data:</p>
        <div className='delete-list'>
          <span>
            <KeyRound size={15} /> Encrypted database and model profiles
          </span>
          <span>
            <MessageSquare size={15} /> Local conversation history
          </span>
          <span>
            <Database size={15} /> Saved workspace settings
          </span>
        </div>
        <p className='modal-warning'>This action cannot be undone.</p>
        <label className='field-label' htmlFor='clear-vault-passphrase'>
          Confirm with vault passphrase
        </label>
        <div className='input-wrap modal-passphrase'>
          <Lock size={16} />
          <input
            id='clear-vault-passphrase'
            type='password'
            value={passphrase}
            onChange={event => {
              setPassphrase(event.target.value);
              setError('');
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && passphrase && !checking) {
                event.preventDefault();
                void handleConfirm();
              }
            }}
            placeholder='Enter your vault passphrase'
            autoFocus
          />
        </div>
        {error && (
          <p className='error-line'>
            <CircleAlert size={15} />
            {error}
          </p>
        )}
        <div className='modal-actions'>
          <button className='ghost-button' onClick={cancel} disabled={checking}>
            Keep workspace
          </button>
          <button
            className='danger-button'
            onClick={() => void handleConfirm()}
            disabled={!passphrase || checking}
          >
            {checking ? <RefreshCw className='spin' size={15} /> : <Trash2 size={15} />}
            {checking ? 'Checking passphrase…' : 'Clear workspace'}
          </button>
        </div>
      </section>
    </div>
  );

  async function handleConfirm() {
    setChecking(true);
    setError('');
    const verified = await confirm(passphrase);
    if (!verified) {
      setError('Incorrect vault passphrase. Nothing was deleted.');
      setChecking(false);
    }
  }
}

export function DeleteThreadModal({
  title,
  cancel,
  confirm,
}: {
  title: string;
  cancel: () => void;
  confirm: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cancel]);

  return (
    <div className='modal-backdrop' role='presentation' onMouseDown={cancel}>
      <section
        className='confirm-modal thread-delete-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='delete-thread-title'
        onMouseDown={event => event.stopPropagation()}
      >
        <div className='modal-icon'>
          <Trash2 size={18} />
        </div>
        <p className='eyebrow'>Conversation</p>
        <h2 id='delete-thread-title'>Delete this chat?</h2>
        <p className='muted'>
          The following conversation and its local messages will be permanently removed.
        </p>
        <div className='thread-delete-name'>“{title}”</div>
        <p className='modal-warning'>This action cannot be undone.</p>
        <div className='modal-actions'>
          <button className='ghost-button' onClick={cancel} autoFocus>
            Keep chat
          </button>
          <button className='danger-button' onClick={confirm}>
            <Trash2 size={15} /> Delete chat
          </button>
        </div>
      </section>
    </div>
  );
}
