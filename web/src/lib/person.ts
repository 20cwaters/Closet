import type { Person, PersonId } from '../api';

const KEY = 'closet.person';

export function rememberedPerson(): PersonId | null {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function rememberPerson(id: PersonId | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: just pick each time */
  }
}

/** Who a shared piece is shared with: everyone but its owner ("Sam", "Sam and Jo", "everyone"). */
export function sharedWith(people: Person[] | undefined, owner: PersonId): string | null {
  const others = (people ?? []).filter((p) => p.id !== owner).map((p) => p.name);
  if (!others.length) return null;
  if (others.length === 1) return others[0];
  if (others.length === 2) return `${others[0]} and ${others[1]}`;
  return 'everyone';
}
