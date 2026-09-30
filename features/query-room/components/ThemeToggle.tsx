import { Moon, Sun } from 'lucide-react';
import type { Theme } from '../types';

export default function ThemeToggle({ theme, toggle }: { theme: Theme; toggle: () => void }) {
  const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  return (
    <button className='icon-btn theme-toggle' onClick={toggle} aria-label={label} title={label}>
      {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
