import { motion } from 'motion/react';
import { CircleAlert } from 'lucide-react';
import Logo from '@/features/shared/Logo';
import ThemeToggle from '@/features/shared/ThemeToggle';

export default function UnlockScreen({
  passphrase,
  setPassphrase,
  unlock,
  clearWorkspace,
  error,
}: {
  passphrase: string;
  setPassphrase: (value: string) => void;
  unlock: () => void;
  clearWorkspace: () => void;
  error: string;
}) {
  return (
    <main className='center'>
      <motion.form
        className='auth-card'
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={event => {
          event.preventDefault();
          unlock();
        }}
      >
        <div className='auth-card-head'>
          <Logo href='/' />
          <ThemeToggle />
        </div>
        <div>
          <h1>Unlock workspace</h1>
          <p className='muted'>Enter your passphrase to decrypt your connections and history.</p>
        </div>
        <label className='field'>
          <span className='field-label'>
            Passphrase{' '}
            <span className='required-mark' aria-hidden='true'>
              *
            </span>
          </span>
          <input
            className='input'
            type='password'
            value={passphrase}
            onChange={event => setPassphrase(event.target.value)}
            placeholder='Enter your passphrase'
            autoComplete='current-password'
            autoFocus
            required
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
      </motion.form>
    </main>
  );
}
