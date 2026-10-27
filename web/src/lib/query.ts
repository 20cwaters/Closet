import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '../api';

/**
 * A tiny stale-while-revalidate cache keyed by API path. Screens read with
 * useQuery('/items?person=sam'); mutations call invalidate('/items') to refetch
 * every key with that prefix, or setQueryData for an optimistic update.
 */
interface Entry {
  data?: unknown;
  error?: Error;
  inflight?: Promise<void>;
  fetchedAt?: number;
  version: number;
}

const cache = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();

const entry = (key: string) => {
  let e = cache.get(key);
  if (!e) cache.set(key, (e = { version: 0 }));
  return e;
};

const emit = (key: string) => subs.get(key)?.forEach((f) => f());

function load(key: string) {
  const e = entry(key);
  if (e.inflight) return e.inflight;
  e.inflight = api
    .get(key)
    .then(
      (data) => Object.assign(e, { data, error: undefined, fetchedAt: Date.now() }),
      (error: Error) => Object.assign(e, { error }),
    )
    .then(() => {
      e.inflight = undefined;
      e.version++;
      emit(key);
    });
  return e.inflight;
}

export function invalidate(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      if (subs.get(key)?.size) load(key);
      else cache.delete(key);
    }
  }
}

export function setQueryData<T>(key: string, update: (prev: T | undefined) => T | undefined) {
  const e = entry(key);
  e.data = update(e.data as T | undefined);
  e.version++;
  emit(key);
}

/** Cached keys starting with `prefix` (e.g. every person's item list). */
export function cachedKeys(prefix: string) {
  return [...cache.keys()].filter((k) => k.startsWith(prefix));
}

export function prefetch(key: string) {
  if (!cache.get(key)?.data) load(key);
}

/** `maxAge` (ms): refetch when older than this, and keep refreshing while mounted. */
export function useQuery<T>(key: string | null, opts: { maxAge?: number } = {}) {
  const { maxAge } = opts;
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => {};
      let set = subs.get(key);
      if (!set) subs.set(key, (set = new Set()));
      set.add(cb);
      return () => set!.delete(cb);
    },
    [key],
  );
  useSyncExternalStore(subscribe, () => (key ? entry(key).version : -1));

  useEffect(() => {
    if (!key) return;
    load(key);
    if (!maxAge) return;
    const t = setInterval(() => {
      const e = cache.get(key);
      if (!e?.fetchedAt || Date.now() - e.fetchedAt >= maxAge) load(key);
    }, Math.min(maxAge, 60_000));
    return () => clearInterval(t);
  }, [key, maxAge]);

  const e = key ? cache.get(key) : undefined;
  return {
    data: e?.data as T | undefined,
    error: e?.error,
    loading: !!key && e?.data === undefined && !e?.error,
    refresh: useCallback(() => (key ? load(key) : Promise.resolve()), [key]),
  };
}
