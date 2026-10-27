import { motion } from 'framer-motion';
import { Camera, Check, Pencil } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, outfitsKey, wornKey, type Outfit, type PersonId } from '../api';
import { ItemImage } from '../components/ItemImage';
import { OutfitMedia } from '../components/OutfitTile';
import { Toast, type ToastMessage } from '../components/Toast';
import { setBuild, type Picks } from '../lib/buildState';
import { localToday, relativeDay, wornLabel } from '../lib/dates';
import { spring } from '../lib/motion';
import { uploadOutfitPhoto, wearToday } from '../lib/outfits';
import { invalidate, setQueryData, useQuery } from '../lib/query';
import { closeOverlay, navigate, openOverlay } from '../router';
import { EditableTitle, Overlay, Reveal, Section } from './Overlay';

export function OutfitDetail({ id, person }: { id: number; person: PersonId }) {
  const { data: outfits } = useQuery<Outfit[]>(outfitsKey(person));
  const listed = outfits?.find((o) => o.id === id);
  const { data: fetched, error } = useQuery<Outfit>(outfits && !listed ? `/outfits/${id}` : null);
  const outfit = listed ?? fetched;
  const { data: worn } = useQuery<{ itemIds: number[] }>(wornKey(person));
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [aspect, setAspect] = useState(3 / 4);
  const close = () => closeOverlay('outfit');

  if (error) {
    return (
      <Overlay onClose={close}>
        <p className="px-6 pt-10 text-center text-label text-muted">This outfit isn't here any more.</p>
      </Overlay>
    );
  }
  if (!outfit) return null;

  const itemIds = outfit.items.map((i) => i.id);
  const wornToday = itemIds.length > 0 && itemIds.every((i) => worn?.itemIds.includes(i));
  const saved = relativeDay(outfit.createdAt.slice(0, 10));

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setProgress(0);
    try {
      await uploadOutfitPhoto(outfit, file, setProgress);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const wear = async () => {
    const undo = await wearToday(person, itemIds);
    setToast({ id: Date.now(), text: 'Logged for today', action: { label: 'Undo', run: undo } });
  };

  /** Edit: back into Build's rows, as saved (layers in order); Save there updates this outfit. */
  const edit = () => {
    const selected: Picks = { headwear: [], outerwear: [], top: [], bottom: [], shoes: [] };
    for (const item of outfit.items) {
      const slot = item.slot ?? item.categories[0];
      if (slot) selected[slot]!.push(item.id);
    }
    setBuild(person, (s) => ({
      selected,
      locked: [],
      outerwear: selected.outerwear!.length ? true : s.outerwear,
      seeded: localToday(),
      editing: { id: outfit.id, name: outfit.name },
    }));
    navigate(`/${person}/build`);
  };

  const remove = async () => {
    if (!confirm('Delete this outfit? The pieces stay in your closet.')) return;
    await api.del(`/outfits/${outfit.id}`);
    setQueryData<Outfit[]>(outfitsKey(person), (list) => list?.filter((o) => o.id !== outfit.id));
    invalidate('/items/');
    close();
  };

  const rename = async (name: string) => {
    const updated = await api.patch<Outfit>(`/outfits/${outfit.id}`, { name });
    setQueryData<Outfit[]>(outfitsKey(person), (list) => list?.map((o) => (o.id === updated.id ? updated : o)));
  };

  return (
    <Overlay onClose={close}>
      <div className="flex flex-col pb-10 rail:h-full rail:flex-row rail:pb-0">
        <div className="mx-5 flex shrink-0 justify-center rail:mx-8 rail:mb-8 rail:flex-1">
          <motion.div
            layoutId={`outfit-${outfit.id}`}
            transition={spring.glide}
            className="relative h-[56svh] max-w-full overflow-hidden rounded-lg bg-stage rail:h-full"
            style={{ aspectRatio: outfit.photo ? aspect : 3 / 4 }}
          >
            <OutfitMedia outfit={outfit} full onAspect={setAspect} />
          </motion.div>
        </div>

        <Reveal className="px-5 pt-5 rail:flex rail:w-[28rem] rail:shrink-0 rail:flex-col rail:overflow-y-auto rail:pt-0 rail:pr-8 rail:pb-8 rail:pl-0">
          <EditableTitle value={outfit.name} placeholder="Add a name" onSave={rename} editable />
          <p className="mt-1 text-label text-muted">
            {[saved && `Saved ${saved}`, wornLabel(outfit.lastWorn)].filter(Boolean).join(' · ')}
          </p>

          <div className="relative mt-6 flex flex-col gap-2">
            <Toast message={toast} onDone={() => setToast(null)} />
            <motion.button
              whileTap={{ scale: 0.97 }}
              transition={spring.snappy}
              onClick={wear}
              disabled={wornToday}
              className={`flex min-h-14 items-center justify-center gap-2 rounded-full text-body font-medium ${
                wornToday ? 'bg-stage text-ink' : 'bg-ink text-on-ink'
              }`}
            >
              <Check size={20} strokeWidth={2.2} /> {wornToday ? 'Worn today' : 'Wear today'}
            </motion.button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={progress !== null}
                className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-stage text-label font-medium"
              >
                <Camera size={18} />
                {progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : outfit.photo ? 'Replace photo' : 'Add photo'}
              </button>
              <button
                onClick={edit}
                className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-stage text-label font-medium"
              >
                <Pencil size={18} /> Edit outfit
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </div>

          <Section title={`${outfit.items.length} ${outfit.items.length === 1 ? 'piece' : 'pieces'}`}>
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-stage p-3">
              {outfit.items.map((item) => (
                <motion.button
                  key={item.id}
                  whileTap={{ scale: 0.95 }}
                  transition={spring.snappy}
                  onClick={() => openOverlay('item', item.id)}
                  className="flex aspect-square items-center justify-center p-2"
                  aria-label={item.name ?? item.categories[0] ?? 'piece'}
                >
                  <ItemImage item={item} layoutId={`item-${item.id}`} className={item.archived ? 'opacity-40' : ''} />
                </motion.button>
              ))}
            </div>
          </Section>

          <button onClick={remove} className="mt-8 min-h-tap self-start rounded-full px-1 text-label text-danger">
            Delete outfit
          </button>
        </Reveal>
      </div>
    </Overlay>
  );
}
