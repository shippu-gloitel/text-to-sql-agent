import { CircleAlert } from 'lucide-react';
import type { Theme } from '../types';
import Logo from './Logo';
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
    <main className='center'>
      <form
        className='auth-card'
        onSubmit={event => {
          event.preventDefault();
          unlock();
        }}
      >
        <div className='auth-card-head'>
          <Logo />
          <ThemeToggle theme={theme} toggle={toggleTheme} />
        </div>
        <div>
          <h1>Unlock workspace</h1>
          <p className='muted'>Enter your passphrase to decrypt your connections and history.</p>
        </div>
        <label className='field'>
          <span className='field-label'>Passphrase</span>
          <input
            className='input'
            type='password'
            value={passphrase}
            onChange={event => setPassphrase(event.target.value)}
            placeholder='Enter your passphrase'
            autoComplete='current-password'
            autoFocus
          />
        </label>
        {error && (
          <p className='error-text' role='alert'>
            <CircleAlert size={14} />
            {error}
          </p>
        )}
        <button type='submit' className='btn btn-primary btn-block' disabled={!passphrase}>
          Unlock
        </button>
        <p className='auth-card-foot'>
          Forgot your passphrase?{' '}
          <button type='button' className='link-btn' onClick={clearWorkspace}>
            Clear this workspace
          </button>
        </p>
      </form>
    </main>
  );
}
