'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from './theme';

export default function ThemeToggle() {
  const theme = useTheme();
  const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  return (
    <button
      className='icon-btn theme-toggle'
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      aria-label={label}
      title={label}
    >
      <AnimatePresence mode='wait' initial={false}>
        <motion.span
          key={theme}
          style={{ display: 'grid' }}
          initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.18 }}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
