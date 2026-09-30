import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';

function Modal({
  labelledBy,
  cancel,
  children,
}: {
  labelledBy: string;
  cancel: () => void;
  children: ReactNode;
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
        className='modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby={labelledBy}
        onMouseDown={event => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

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

  const handleConfirm = async () => {
    setChecking(true);
    setError('');
    const verified = await confirm(passphrase);
    if (!verified) {
      setError('Incorrect passphrase. Nothing was deleted.');
      setChecking(false);
    }
  };

  return (
    <Modal labelledBy='clear-workspace-title' cancel={cancel}>
      <h2 id='clear-workspace-title'>Clear workspace?</h2>
      <p>This permanently deletes everything stored in this browser:</p>
      <ul>
        <li>Database and model connection details</li>
        <li>All conversations and saved results</li>
      </ul>
      <form
        className='field'
        onSubmit={event => {
          event.preventDefault();
          if (passphrase && !checking) void handleConfirm();
        }}
      >
        <label className='field-label' htmlFor='clear-vault-passphrase'>
          Enter your passphrase to confirm
        </label>
        <input
          id='clear-vault-passphrase'
          className='input'
          type='password'
          value={passphrase}
          onChange={event => {
            setPassphrase(event.target.value);
            setError('');
          }}
          placeholder='Passphrase'
          autoComplete='current-password'
          autoFocus
        />
      </form>
      {error && (
        <p className='error-text' role='alert'>
          <CircleAlert size={14} />
          {error}
        </p>
      )}
      <div className='modal-actions'>
        <button className='btn btn-ghost' onClick={cancel} disabled={checking}>
          Cancel
        </button>
        <button
          className='btn btn-danger'
          onClick={() => void handleConfirm()}
          disabled={!passphrase || checking}
        >
          {checking && <LoaderCircle className='spin' size={14} />}
          Clear workspace
        </button>
      </div>
    </Modal>
  );
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
  return (
    <Modal labelledBy='delete-thread-title' cancel={cancel}>
      <h2 id='delete-thread-title'>Delete conversation?</h2>
      <p>“{title}” and its results will be permanently deleted from this browser.</p>
      <div className='modal-actions'>
        <button className='btn btn-ghost' onClick={cancel} autoFocus>
          Cancel
        </button>
        <button className='btn btn-danger' onClick={confirm}>
          Delete
        </button>
      </div>
    </Modal>
  );
}
