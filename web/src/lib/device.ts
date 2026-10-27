import { useSyncExternalStore } from 'react';

/** The closet tablet (or any big screen) vs. a phone. Phones are short in one dimension. */
const largeQuery = matchMedia('(min-width: 600px) and (min-height: 600px)');
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');

const useMedia = (q: MediaQueryList) =>
  useSyncExternalStore(
    (cb) => {
      q.addEventListener('change', cb);
      return () => q.removeEventListener('change', cb);
    },
    () => q.matches,
  );

export const isLargeScreen = () => largeQuery.matches;
export const useLargeScreen = () => useMedia(largeQuery);
export const prefersReducedMotion = () => reducedQuery.matches;

/** Tablet in landscape: navigation moves to a side rail to give Build its height back. */
const railQuery = matchMedia('(orientation: landscape) and (min-height: 600px)');
export const useRail = () => useMedia(railQuery);
