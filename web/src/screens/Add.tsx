import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Camera, Check, Images, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, itemsKey, type Item, type PersonId } from '../api';
import { ItemImage } from '../components/ItemImage';
import { PrimaryButton } from '../components/Empty';
import { ScreenHeader } from '../components/ScreenHeader';
import { TagEditor } from '../components/TagEditor';
import { dropItem } from '../lib/items';
import { spring } from '../lib/motion';
import { useQuery } from '../lib/query';
import { addPhotos, clearFinished, dismissUpload, retryUpload, useUploads, type Upload } from '../lib/uploads';
import { navigate, setParam, useLocation } from '../router';

/**
 * Add: pick or take photos, then tag them one at a time while they upload and their
 * backgrounds are removed. Every choice saves immediately, so leaving midway loses nothing.
 */
export function Add({ person }: { person: PersonId }) {
  const { params } = useLocation();
  const uploads = useUploads(person);
  const { data: items, refresh } = useQuery<Item[]>(itemsKey(person));
  const [extraIds, setExtraIds] = useState<number[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);

  // Coming from Closet's "Tag them": pull in everything that still needs a category.
  useEffect(() => {
    if (params.get('tag') !== 'untagged' || !items) return;
    setExtraIds(items.filter((i) => i.owner === person && !i.categories.length).map((i) => i.id));
    setParam('tag', null, { replace: true });
  }, [params, items, person]);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const sessionIds = useMemo(() => {
    const ids = [...extraIds, ...uploads.flatMap((u) => (u.itemId ? [u.itemId] : []))];
    return [...new Set(ids)].filter((id) => byId.has(id));
  }, [extraIds, uploads, byId]);
  const pending = uploads.filter((u) => u.stage !== 'done');

  // Keep polling while cutouts and AI versions are being made.
  const processing = sessionIds.some((id) => {
    const i = byId.get(id);
    return i?.status === 'processing' || i?.ai?.status === 'processing';
  });
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [processing, refresh]);

  // The photo being tagged is pinned, so tagging it doesn't skip ahead before you press Next.
  const firstUntagged = sessionIds.find((id) => !byId.get(id)?.categories.length) ?? null;
  const pinned = currentId !== null && sessionIds.includes(currentId) ? currentId : null;
  useEffect(() => {
    if (pinned === null && firstUntagged !== null) setCurrentId(firstUntagged);
  }, [pinned, firstUntagged]);
  const current = pinned ?? firstUntagged;

  const next = () => {
    const at = sessionIds.indexOf(current ?? -1);
    const after = [...sessionIds.slice(at + 1), ...sessionIds.slice(0, at)];
    setCurrentId(after.find((id) => !byId.get(id)?.categories.length) ?? null);
  };

  const finish = () => {
    clearFinished(person);
    setExtraIds([]);
    setCurrentId(null);
  };

  const pickers = <PhotoPickers person={person} />;

  if (!sessionIds.length && !pending.length) {
    const untagged = (items ?? []).filter((i) => i.owner === person && !i.categories.length);
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader title="Add clothes" />
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-10">
          <div className="max-w-sm text-center">
            <p className="font-serif text-title">One piece per photo</p>
            <p className="mt-2 text-label text-muted">
              Lay it flat on a plain background. For white pieces, or anything with big white prints,
              use a colored background instead. Add as many as you like, then tag them while they upload.
            </p>
          </div>
          {pickers}
          {untagged.length > 0 && (
            <button
              className="min-h-tap text-label text-accent underline-offset-4 active:underline"
              onClick={() => setExtraIds(untagged.map((i) => i.id))}
            >
              {untagged.length} {untagged.length === 1 ? 'piece needs' : 'pieces need'} a category
            </button>
          )}
        </div>
      </div>
    );
  }

  const item = current != null ? byId.get(current) : undefined;
  const allDone = !item && !pending.length;
  const tagged = sessionIds.filter((id) => byId.get(id)?.categories.length).length;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={allDone ? 'All set' : 'Tag your clothes'}>
        <span className="text-label text-muted tabular-nums">
          {tagged} of {sessionIds.length + pending.length}
        </span>
      </ScreenHeader>
      <Strip
        uploads={pending}
        ids={sessionIds}
        byId={byId}
        current={current}
        onPick={setCurrentId}
        person={person}
      />
      {allDone ? (
        <Done count={sessionIds.length} person={person} onAddMore={finish} />
      ) : item ? (
        <Tagger key={item.id} item={item} onNext={next} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-label text-muted">
          Preparing photos…
        </div>
      )}
    </div>
  );
}

function PhotoPickers({ person, compact }: { person: PersonId; compact?: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const onFiles = (files: FileList | null) => {
    if (files?.length) addPhotos(person, files);
  };
  const inputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      <input ref={library} type="file" accept="image/*" multiple hidden
        onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
    </>
  );
  if (compact) {
    return (
      <>
        <button
          onClick={() => library.current?.click()}
          className="grid size-14 shrink-0 place-items-center rounded-md border border-dashed border-line text-muted"
          aria-label="Add more photos"
        >
          <Plus size={22} />
        </button>
        {inputs}
      </>
    );
  }
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={spring.snappy}
        onClick={() => camera.current?.click()}
        className="flex min-h-16 items-center justify-center gap-3 rounded-lg bg-ink text-body font-medium text-on-ink"
      >
        <Camera size={22} /> Take a photo
      </motion.button>
      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={spring.snappy}
        onClick={() => library.current?.click()}
        className="flex min-h-16 items-center justify-center gap-3 rounded-lg bg-stage text-body font-medium"
      >
        <Images size={22} /> Choose photos
      </motion.button>
      {inputs}
    </div>
  );
}

/** Thumbnails of this batch: progress for uploads, thumbnails once they're items. */
function Strip({ uploads, ids, byId, current, onPick, person }: {
  uploads: Upload[];
  ids: number[];
  byId: Map<number, Item>;
  current: number | null;
  onPick: (id: number) => void;
  person: PersonId;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [current]);

  return (
    <div ref={ref} className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-5 py-2 rail:px-8">
      {ids.map((id) => {
        const item = byId.get(id)!;
        return (
          <button
            key={id}
            onClick={() => onPick(id)}
            aria-current={id === current}
            aria-label={item.categories.length ? `Tagged ${item.categories.join(', ')}` : 'Untagged photo'}
            className={`relative flex size-14 shrink-0 items-center justify-center rounded-md bg-stage p-1 transition-opacity ${
              id === current ? 'ring-2 ring-ink' : item.categories.length ? 'opacity-60' : ''
            }`}
          >
            <ItemImage item={item} />
            {item.categories.length > 0 && (
              <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-ink text-on-ink">
                <Check size={12} strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
      {uploads.map((u) => (
        <UploadTile key={u.key} upload={u} />
      ))}
      <PhotoPickers person={person} compact />
    </div>
  );
}

function UploadTile({ upload: u }: { upload: Upload }) {
  if (u.stage === 'error') {
    return (
      <button
        onClick={() => (confirm(`${u.error}\n\nTry again?`) ? retryUpload(u.key) : dismissUpload(u.key))}
        className="grid size-14 shrink-0 place-items-center rounded-md bg-stage text-danger"
        aria-label={`Upload failed: ${u.error}. Tap to retry.`}
      >
        <AlertCircle size={20} />
      </button>
    );
  }
  // A ring that fills as the photo uploads (resizing counts as the first 10%).
  const frac = u.stage === 'uploading' ? 0.1 + u.progress * 0.9 : u.stage === 'resizing' ? 0.05 : 0;
  const r = 10;
  const c = 2 * Math.PI * r;
  return (
    <div className="grid size-14 shrink-0 place-items-center rounded-md bg-stage" aria-label="Uploading">
      <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90">
        <circle cx="14" cy="14" r={r} fill="none" stroke="var(--line)" strokeWidth="2.5" />
        <circle cx="14" cy="14" r={r} fill="none" stroke="var(--ink)" strokeWidth="2.5"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 200ms linear' }} />
      </svg>
    </div>
  );
}

function Tagger({ item, onNext }: { item: Item; onNext: () => void }) {
  const [hasCategory, setHasCategory] = useState(item.categories.length > 0);

  const remove = async () => {
    if (!confirm('Delete this photo?')) return;
    await api.del(`/items/${item.id}`);
    dropItem(item.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rail:flex-row rail:overflow-visible">
      <div className="relative mx-5 mt-2 min-h-[38svh] flex-1 overflow-hidden rounded-lg bg-stage rail:mx-8 rail:mb-6 rail:min-h-0">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={`${item.id}-${item.status}-${item.useAi}`}
            className="absolute inset-0 flex items-center justify-center px-6 pt-6 pb-10"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={spring.snappy}
          >
            <ItemImage item={item} full className={item.status === 'processing' ? 'opacity-70' : ''} />
          </motion.div>
        </AnimatePresence>
        <p className="absolute inset-x-0 bottom-3 text-center text-caption text-muted">
          {item.status === 'processing' && 'Removing the background…'}
          {item.status === 'ready' && item.ai?.status === 'processing' && 'Making the AI version…'}
          {item.status === 'failed' && "Couldn't remove the background, so the photo is used as is"}
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-4 px-5 pt-4 pb-4 rail:w-[26rem] rail:overflow-y-auto rail:pt-0 rail:pr-8 rail:pl-0">
        <TagEditor item={item} onCategories={(c) => setHasCategory(c.length > 0)} />
        {/* Pinned so Next is always one thumb-tap away, even when the controls scroll. */}
        <div className="sticky bottom-0 -mx-5 -mb-4 flex items-center gap-3 bg-paper px-5 py-3 rail:mx-0 rail:mb-0 rail:px-0">
          <button
            onClick={remove}
            className="grid size-tap shrink-0 place-items-center rounded-full text-muted active:bg-stage"
            aria-label="Delete photo"
          >
            <Trash2 size={20} />
          </button>
          <div className="flex-1 [&>button]:w-full">
            <PrimaryButton onClick={onNext} disabled={!hasCategory}>
              Next
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Done({ count, person, onAddMore }: { count: number; person: PersonId; onAddMore: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-10 text-center">
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.settle}
        className="grid size-16 place-items-center rounded-full bg-ink text-on-ink"
      >
        <Check size={28} strokeWidth={2.5} />
      </motion.span>
      <p className="font-serif text-title">
        {count === 1 ? 'One piece added' : `${count} pieces added`}
      </p>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <PrimaryButton onClick={() => { onAddMore(); navigate(`/${person}/closet`, { replace: true }); }}>
          See your closet
        </PrimaryButton>
        <button onClick={onAddMore} className="min-h-tap rounded-full text-label font-medium active:bg-stage">
          Add more
        </button>
      </div>
    </div>
  );
}
