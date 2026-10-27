import { api, itemsKey, type Item, type PersonId } from '../api';
import { cachedKeys, setQueryData } from './query';

/** Every person whose item list is cached. */
const cachedPeople = (): PersonId[] =>
  cachedKeys(itemsKey('')).map((k) => new URLSearchParams(k.split('?')[1]).get('person') ?? '');

/** Merge a changed item into each cached list (everyone's, since shared items show for all). */
export function putItem(item: Item) {
  for (const p of cachedPeople()) {
    setQueryData<Item[]>(itemsKey(p), (list) => {
      if (!list) return list;
      const visible = !item.archived && (item.owner === p || item.shared);
      const rest = list.filter((i) => i.id !== item.id);
      if (!visible) return rest;
      const old = list.find((i) => i.id === item.id);
      return old ? list.map((i) => (i.id === item.id ? { ...item, lastWorn: old.lastWorn } : i)) : [item, ...rest];
    });
  }
}

export function dropItem(id: number) {
  for (const p of cachedPeople()) {
    setQueryData<Item[]>(itemsKey(p), (list) => list?.filter((i) => i.id !== id));
  }
}

export type ItemPatch = Partial<Pick<Item, 'categories' | 'weather' | 'styles' | 'name' | 'shared' | 'archived' | 'useAi' | 'dress'>>;

export async function updateItem(id: number, patch: ItemPatch) {
  const item = await api.patch<Item>(`/items/${id}`, patch);
  putItem(item);
  return item;
}
