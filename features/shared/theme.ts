'use client';

import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'queryroom.theme';
const THEME_EVENT = 'queryroom:theme';

// The inline script in the root layout sets data-theme before first paint; this store keeps React
// in sync with it. The server always renders the dark snapshot, and React re-renders after hydration.
function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function getServerSnapshot(): Theme {
  return 'dark';
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Local storage may be disabled by the browser.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function useTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
