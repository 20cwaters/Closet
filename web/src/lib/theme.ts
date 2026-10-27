import { useSyncExternalStore } from 'react';

/**
 * Light or dark, chosen per device (the tablet and each phone keep their own). Light is the
 * default whatever the device's own setting. index.html applies it before the first paint.
 */
export type Theme = 'light' | 'dark';

const KEY = 'closet-theme';
const BARS: Record<Theme, string> = { light: '#f2f3f1', dark: '#111312' };
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BARS[theme]);
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private mode etc.: still switch for this visit.
  }
  applyTheme(theme);
  listeners.forEach((l) => l());
}

export function useTheme() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getTheme,
  );
}
