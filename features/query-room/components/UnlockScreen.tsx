import { CircleAlert, Lock, Trash2, Unlock } from 'lucide-react';
import type { Theme } from '../types';
import ThemeToggle from './ThemeToggle';

export default function UnlockScreen({
  theme,
  toggleTheme,
  passphrase,
  setPassphrase,
  unlock,
  clearWorkspace,
  error,
}: {
  theme: Theme;
  toggleTheme: () => void;
  passphrase: string;
  setPassphrase: (value: string) => void;
  unlock: () => void;
  clearWorkspace: () => void;
  error: string;
}) {
  return (
    <main className='center-stage'>
      <div className='unlock-card'>
        <div className='unlock-head'>
          <div className='brand-mark'>
            <Lock size={18} />
          </div>
          <ThemeToggle theme={theme} toggle={toggleTheme} />
        </div>
        <p className='eyebrow'>Encrypted workspace</p>
        <h1>Welcome back.</h1>
        <p className='muted'>Unlock your local database and model profiles to continue.</p>
        <label className='field-label' htmlFor='unlock-passphrase'>
          Vault passphrase
        </label>
        <div className='input-wrap'>
          <Lock size={16} />
          <input
            id='unlock-passphrase'
            type='password'
            value={passphrase}
            onChange={event => setPassphrase(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && unlock()}
            placeholder='Enter your passphrase'
            autoFocus
          />
        </div>
        {error && (
          <p className='error-line'>
            <CircleAlert size={15} />
            {error}
          </p>
        )}
        <button className='primary-button full-width' onClick={unlock}>
          <Unlock size={16} />
          Unlock workspace
        </button>
        <button className='text-button danger-text-button' onClick={clearWorkspace}>
          <Trash2 size={14} />
          Clear this workspace
        </button>
      </div>
    </main>
  );
}
