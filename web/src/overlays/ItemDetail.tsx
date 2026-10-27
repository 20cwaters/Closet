import { motion } from 'framer-motion';
import { Camera, Images, Layers, LoaderCircle, RotateCcw, Sparkles, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, CATEGORIES, img, itemsKey, type AppConfig, type Item, type Outfit, type Person, type PersonId } from '../api';
import { OutfitTile } from '../components/OutfitTile';
import { Chip } from '../components/Toggle';
import { Sheet } from '../components/Sheet';
import { TagEditor, tagSummary } from '../components/TagEditor';
import { wornLabel } from '../lib/dates';
import { dropItem, putItem, updateItem } from '../lib/items';
import { spring } from '../lib/motion';
import { sharedWith } from '../lib/person';
import { invalidate, useQuery } from '../lib/query';
import { ITEM_PHOTO_MAX, resizeImage, upload } from '../lib/resize';
import { closeOverlay, navigate, openOverlay } from '../router';
import { EditableTitle, Overlay, Reveal, Section } from './Overlay';

export function ItemDetail({ id, person }: { id: number; person: PersonId }) {
  const { data: items, refresh } = useQuery<Item[]>(itemsKey(person));
  const listed = items?.find((i) => i.id === id);
  // Archived or someone else's unshared piece isn't in the list; fetch it directly.
  const { data: fetched, error } = useQuery<Item>(items && !listed ? `/items/${id}?person=${person}` : null);
  const item = listed ?? fetched;
  const { data: outfits } = useQuery<Outfit[]>(`/items/${id}/outfits?person=${person}`);
  const { data: people } = useQuery<Person[]>('/people');
  const close = () => closeOverlay('item');
  const [retaking, setRetaking] = useState(false);

  // A retaken photo is being cut out, or the AI version made: check back until it's done.
  const processing = item?.status === 'processing' || item?.ai?.status === 'processing';
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [processing, refresh]);

  if (error) {
    return (
      <Overlay onClose={close} z={50}>
        <p className="px-6 pt-10 text-center text-label text-muted">This piece isn't here any more.</p>
      </Overlay>
    );
  }
  if (!item) return null;

  const own = item.owner === person;
  const owner = people?.find((p) => p.id === item.owner);
  const others = sharedWith(people, item.owner);
  const save = (patch: Parameters<typeof updateItem>[1]) => updateItem(item.id, patch).catch((e) => alert(e.message));
  const firstCategory = CATEGORIES.find((c) => c.id === item.categories[0]);

  const meta = [
    own ? (item.shared && others ? `Shared with ${others}` : null) : `${owner?.name ?? 'Someone'}'s, shared with you`,
    tagSummary(item),
    wornLabel(item.lastWorn),
  ].filter(Boolean);

  const remove = async () => {
    const inOutfits = outfits?.length
      ? ` It's also taken out of ${outfits.length === 1 ? 'the outfit' : `the ${outfits.length} outfits`} it's in.`
      : '';
    if (!confirm(`Delete this piece? This can't be undone.${inOutfits}`)) return;
    try {
      await api.del(`/items/${item.id}`);
    } catch (e) {
      return alert((e as Error).message);
    }
    dropItem(item.id);
    invalidate('/outfits');
    close();
  };

  const retry = async () => {
    putItem(await api.post<Item>(`/items/${item.id}/retry`));
    invalidate(itemsKey(person));
  };

  return (
    <Overlay onClose={close} z={50}>
      <div className="flex flex-col pb-10 rail:h-full rail:flex-row rail:pb-0">
        <div className="mx-5 flex h-[46svh] shrink-0 items-center justify-center rounded-lg bg-stage p-8 rail:mx-8 rail:mb-8 rail:h-auto rail:flex-1 rail:p-12">
          <HeroImage item={item} />
        </div>

        <Reveal className="px-5 pt-5 rail:w-[28rem] rail:shrink-0 rail:overflow-y-auto rail:pt-0 rail:pr-8 rail:pb-8 rail:pl-0">
          <EditableTitle
            value={item.name}
            placeholder={own ? 'Add a name' : (firstCategory?.one ?? 'Piece')}
            onSave={(name) => save({ name })}
            editable={own}
          />
          <p className="mt-1 flex items-center gap-1.5 text-label text-muted">
            {item.shared && <Users size={14} className="shrink-0" />}
            {meta.join(' · ')}
          </p>
          {item.styles.length > 0 && <p className="mt-0.5 text-label text-muted">{item.styles.join(', ')}</p>}

          {item.archived ? (
            <div className="mt-6 flex items-center gap-3 rounded-md border border-line px-4 py-3">
              <p className="flex-1 text-label">Archived</p>
              {own && (
                <button onClick={() => save({ archived: false })} className="min-h-tap px-2 text-label font-medium text-accent">
                  Restore
                </button>
              )}
            </div>
          ) : (
            item.categories.length > 0 && (
              <motion.button
                whileTap={{ scale: 0.97 }}
                transition={spring.snappy}
                onClick={() => navigate(`/${person}/build?around=${item.id}`)}
                className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-ink text-body font-medium text-on-ink"
              >
                <Layers size={20} /> Build around this
              </motion.button>
            )
          )}

          {own && item.status === 'ready' && !item.archived && <Perfect item={item} />}

          {item.status === 'failed' && own && (
            <div className="mt-4 flex items-center gap-3 rounded-md border border-line px-4 py-3">
              <p className="flex-1 text-label text-muted">The background couldn't be removed.</p>
              <button onClick={retry} className="flex min-h-tap items-center gap-1.5 px-2 text-label font-medium text-accent">
                <RotateCcw size={16} /> Try again
              </button>
            </div>
          )}

          <Section title={outfits?.length ? `In ${outfits.length === 1 ? 'one outfit' : `${outfits.length} outfits`}` : 'Outfits'}>
            {outfits?.length ? (
              <div className="grid grid-cols-3 gap-3">
                {outfits.map((o) => (
                  <OutfitTile key={o.id} outfit={o} caption={false} onOpen={() => openOverlay('outfit', o.id, 'item')} />
                ))}
              </div>
            ) : (
              <p className="text-label text-muted">Not in any saved outfits yet. Build one around it.</p>
            )}
          </Section>

          {own && (
            <Section title="Details">
              <div className="flex flex-col gap-4">
                <TagEditor item={item} />
                <button
                  onClick={() => setRetaking(true)}
                  disabled={item.status === 'processing'}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-stage text-label font-medium disabled:opacity-50"
                >
                  <Camera size={18} /> {item.status === 'processing' ? 'Removing the background…' : 'Retake photo'}
                </button>
                <button onClick={remove} className="min-h-tap self-start rounded-full px-1 text-label text-danger">
                  Delete this piece
                </button>
              </div>
            </Section>
          )}
          <RetakeSheet item={item} open={retaking} onClose={() => setRetaking(false)} />
        </Reveal>
      </div>
    </Overlay>
  );
}

/**
 * The hero starts on the thumbnail the browser already has (so the shared-element flight
 * never shows a blank frame), then swaps to the full-size cutout once it has decoded.
 */
function HeroImage({ item }: { item: Item }) {
  const fullSrc = item.cutout ?? item.original;
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    const im = new Image();
    im.src = img(fullSrc)!;
    im.decode().then(() => setLoaded(fullSrc), () => {});
  }, [fullSrc]);
  const src = loaded === fullSrc ? fullSrc : (item.thumb ?? item.original);
  const isCutout = item.status === 'ready' && !!item.cutout;
  return (
    <motion.img
      layoutId={`item-${item.id}`}
      src={img(src)}
      alt={item.name ?? ''}
      draggable={false}
      className={`max-h-full max-w-full ${isCutout ? 'cutout' : 'rounded-md object-contain'}`}
      transition={spring.glide}
    />
  );
}

/**
 * "Make it perfect": an AI-redrawn product shot of the piece. Once made, a two-way switch
 * picks which one the closet shows; the real photo is always kept.
 */
function Perfect({ item }: { item: Item }) {
  const { data: config } = useQuery<AppConfig>('/config');
  const [starting, setStarting] = useState(false);
  if (!config?.ai) return null;

  const start = async () => {
    setStarting(true);
    try {
      putItem(await api.post<Item>(`/items/${item.id}/ai`));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setStarting(false);
    }
  };
  const working = starting || item.ai?.status === 'processing';

  if (item.ai?.status === 'ready') {
    return (
      <div className="mt-4">
        <div role="group" aria-label="Which picture to show" className="grid grid-cols-2 gap-2">
          <Chip on={!item.useAi} onClick={() => item.useAi && updateItem(item.id, { useAi: false })}>
            Your photo
          </Chip>
          <Chip on={item.useAi} onClick={() => !item.useAi && updateItem(item.id, { useAi: true })}>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles size={16} /> Perfect
            </span>
          </Chip>
        </div>
        <button onClick={start} className="mt-1 min-h-tap px-1 text-label text-muted">
          Not quite right? Redo it
        </button>
      </div>
    );
  }
  return (
    <div className="mt-4">
      <button
        onClick={start}
        disabled={working}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-stage text-label font-medium disabled:opacity-60"
      >
        {working ? <LoaderCircle size={18} className="animate-spin" /> : <Sparkles size={18} />}
        {working ? 'Making it perfect…' : item.ai?.status === 'failed' ? 'Try again' : 'Make it perfect'}
      </button>
      <p className={`mt-1.5 px-1 text-caption ${item.ai?.status === 'failed' && !working ? 'text-danger' : 'text-muted'}`}>
        {working
          ? 'About 30 seconds. You can close this; it keeps going.'
          : item.ai?.status === 'failed'
            ? item.ai.error
            : 'AI redraws it as a clean product photo. Your photo is kept, so you can switch back.'}
      </p>
    </div>
  );
}

/** Retake: a new photo for the same piece. Tags and outfits stay; the cutout is redone. */
function RetakeSheet({ item, open, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setProgress(0);
    try {
      const blob = await resizeImage(file, ITEM_PHOTO_MAX);
      putItem(await upload<Item>(`/api/items/${item.id}/photo`, blob, setProgress));
      invalidate('/outfits');
      onClose();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-3 pb-4">
        <p className="font-serif text-title">Retake photo</p>
        <p className="mt-1 text-label text-muted">Its tags and outfits stay. The background is removed again.</p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => camera.current?.click()}
          disabled={progress !== null}
          className="flex min-h-14 items-center justify-center gap-3 rounded-lg bg-ink text-body font-medium text-on-ink disabled:opacity-60"
        >
          <Camera size={20} /> {progress === null ? 'Take a photo' : `Uploading… ${Math.round(progress * 100)}%`}
        </button>
        <button
          onClick={() => library.current?.click()}
          disabled={progress !== null}
          className="flex min-h-14 items-center justify-center gap-3 rounded-lg bg-stage text-body font-medium"
        >
          <Images size={20} /> Choose a photo
        </button>
        <button onClick={onClose} className="min-h-tap text-label text-muted">
          Cancel
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={library} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
    </Sheet>
  );
}
