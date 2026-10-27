import { useSyncExternalStore } from 'react';
import type { PersonId } from './api';

export type Tab = 'build' | 'outfits' | 'closet' | 'add';
export const TABS: Tab[] = ['build', 'outfits', 'closet', 'add'];

export type Route =
  | { name: 'home' }
  | { name: 'tab'; person: PersonId; tab: Tab };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener('popstate', notify);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const snapshot = () => location.pathname + location.search;

export function navigate(to: string, opts: { replace?: boolean; overlay?: boolean } = {}) {
  if (to === snapshot()) return;
  // Entries that open an overlay are marked, so closing one can simply go back.
  history[opts.replace ? 'replaceState' : 'pushState'](opts.overlay ? { overlay: true } : null, '', to);
  notify();
}

const withParams = (update: (p: URLSearchParams) => void) => {
  const params = new URLSearchParams(location.search);
  update(params);
  const qs = params.toString();
  return location.pathname + (qs ? `?${qs}` : '');
};

/** Set or clear one query param. */
export function setParam(key: string, value: string | number | null, opts: { replace?: boolean } = {}) {
  navigate(withParams((p) => (value === null ? p.delete(key) : p.set(key, String(value)))), opts);
}

type OverlayKey = 'item' | 'outfit' | 'calendar';

/** Open a detail overlay (?item=12, ?outfit=3, ?calendar=2026-10). `drop` closes another overlay in the same step. */
export function openOverlay(key: OverlayKey, id: number | string, drop?: OverlayKey) {
  navigate(
    withParams((p) => {
      if (drop) p.delete(drop);
      p.set(key, String(id));
    }),
    { overlay: true },
  );
}

/** Close an overlay: back if we opened it in-app (so the back button stays in sync), else drop the param. */
export function closeOverlay(key: OverlayKey) {
  if (history.state?.overlay) history.back();
  else setParam(key, null, { replace: true });
}

export function parse(pathname: string): Route {
  // Whether the person exists is checked in App once the people list has loaded.
  const [person, tab] = pathname.split('/').filter(Boolean);
  if (!person) return { name: 'home' };
  return { name: 'tab', person, tab: TABS.includes(tab as Tab) ? (tab as Tab) : 'build' };
}

export function useLocation() {
  const loc = useSyncExternalStore(subscribe, snapshot);
  const [pathname, search = ''] = loc.split('?');
  return { route: parse(pathname), params: new URLSearchParams(search) };
}
