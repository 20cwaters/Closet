import { useSyncExternalStore } from 'react';

/** The "How Closet works" tour: shown once per device, and again from the avatar menu. */
const KEY = 'closet.tutorialSeen';

let open = false;
const listeners = new Set<() => void>();
const set = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};

export function tutorialSeen() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // private mode: don't show it on every visit
  }
}

export const openTutorial = () => set(true);

export function closeTutorial() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode */
  }
  set(false);
}

export const useTutorialOpen = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
