import { useSyncExternalStore } from 'react';
import type { Category, PersonId } from '../api';

/**
 * The combination on the Build screen, per person. Lives outside React so it survives
 * switching tabs; resets when the app reloads (the daily pick fills it in again).
 */
/** Selected item per row, per layer (tops and outerwear can have several); null = None. */
export type Picks = Partial<Record<Category, (number | null)[]>>;

export interface BuildState {
  selected: Picks;
  /** Locked rows, as "category:layer" (e.g. "top:0"). */
  locked: string[];
  /** null = follow the weather; true/false = the person toggled it. */
  outerwear: boolean | null;
  /**
   * The day (YYYY-MM-DD) the rows were last filled: by the daily pick, "Build around this"
   * or "Open in Build". A new day reloads the pick; until then the person's choices stay.
   */
  seeded: string | null;
  /** Editing a saved outfit ("Edit outfit"): Save updates it instead of making a new one. */
  editing: { id: number; name: string | null } | null;
  /** What bottoms and outerwear were before a dress cleared them, to put back when swiping off it. */
  beforeDress: Pick<Picks, 'bottom' | 'outerwear'> | null;
  /** Shuffle only within this style (e.g. "Casual"); null = any style. */
  styleFilter: string | null;
}

const empty = (): BuildState => ({
  selected: {},
  locked: [],
  outerwear: null,
  seeded: null,
  editing: null,
  beforeDress: null,
  styleFilter: null,
});
const states = new Map<PersonId, BuildState>();
const listeners = new Set<() => void>();

export function getBuild(person: PersonId) {
  let s = states.get(person);
  if (!s) states.set(person, (s = empty()));
  return s;
}

export function setBuild(person: PersonId, update: (s: BuildState) => Partial<BuildState>) {
  const prev = getBuild(person);
  states.set(person, { ...prev, ...update(prev) });
  listeners.forEach((l) => l());
}

export function useBuild(person: PersonId) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getBuild(person),
  );
}
