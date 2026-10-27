import { api, outfitsKey, wornKey, type Outfit, type PersonId } from '../api';
import { invalidate, setQueryData } from './query';
import { resizeImage, upload } from './resize';

/** Outfit photos share the item upload path (resize in the browser), minus background removal. */
export async function uploadOutfitPhoto(outfit: Outfit, file: File, onProgress?: (f: number) => void) {
  const blob = await resizeImage(file, 1200);
  const updated = await upload<Outfit>(`/api/outfits/${outfit.id}/photo`, blob, onProgress);
  setQueryData<Outfit[]>(outfitsKey(outfit.person), (list) => list?.map((o) => (o.id === updated.id ? updated : o)));
  invalidate('/items/'); // "outfits containing this item" lists
  return updated;
}

/** Log every piece as worn today. Returns an undo. */
export async function wearToday(person: PersonId, itemIds: number[]) {
  const r = await api.post<{ date: string }>('/wear', { person, itemIds });
  setQueryData<{ date: string; itemIds: number[] }>(wornKey(person), (w) => ({
    date: r.date,
    itemIds: [...new Set([...(w?.itemIds ?? []), ...itemIds])],
  }));
  invalidate(`/items?person=${person}`);
  invalidate(outfitsKey(person));
  return async () => {
    await api.del('/wear', { person, itemIds, date: r.date });
    invalidate(wornKey(person));
    invalidate(`/items?person=${person}`);
    invalidate(outfitsKey(person));
  };
}
