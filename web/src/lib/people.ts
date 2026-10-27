import { api, type Person, type PersonId } from '../api';
import { rememberedPerson, rememberPerson } from './person';
import { invalidate, setQueryData } from './query';

export const peopleKey = '/people';

/** Add someone; returns their new id (a slug of the name). */
export async function addPerson(name: string): Promise<PersonId> {
  const { id, people } = await api.post<{ id: PersonId; people: Person[] }>('/people', { name });
  setQueryData<Person[]>(peopleKey, () => people);
  return id;
}

export async function renamePerson(id: PersonId, name: string) {
  const people = await api.patch<Person[]>(`/people/${id}`, { name });
  setQueryData<Person[]>(peopleKey, () => people);
}

/** What removing someone deletes, for the confirmation. */
export const personSummary = (id: PersonId) => api.get<{ items: number; outfits: number }>(`/people/${id}/summary`);

export async function removePerson(id: PersonId) {
  const people = await api.del<Person[]>(`/people/${id}`);
  setQueryData<Person[]>(peopleKey, () => people);
  if (rememberedPerson() === id) rememberPerson(null);
  // Shared pieces and outfits of theirs may show in other people's lists.
  ['/items', '/outfits', '/wear', '/calendar', '/suggestion'].forEach(invalidate);
}
