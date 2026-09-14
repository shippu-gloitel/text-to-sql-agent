import { Moon, Sun } from 'lucide-react';
import type { Theme } from '../types';

export default function ThemeToggle({ theme, toggle }: { theme: Theme; toggle: () => void }) {
  const lightMode = theme === 'light';
  return (
    <button
      className='theme-toggle'
      onClick={toggle}
      aria-label={lightMode ? 'Switch to dark theme' : 'Switch to light theme'}
      aria-pressed={lightMode}
      title={lightMode ? 'Switch to dark theme' : 'Switch to light theme'}
    >
      {lightMode ? <Moon size={15} /> : <Sun size={15} />}
      <span>{lightMode ? 'Dark' : 'Light'}</span>
    </button>
  );
}
