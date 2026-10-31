import { motion } from 'framer-motion';
import { img, type Outfit } from '../api';
import { shortDate } from '../lib/dates';
import { spring } from '../lib/motion';
import { OutfitStack } from './OutfitStack';

/** Photo-first: the outfit photo when there is one, otherwise the composed stack. */
export function OutfitMedia({ outfit, full = false, contain = false, onAspect }: {
  outfit: Outfit;
  full?: boolean;
  /** Show the whole photo rather than filling the frame. */
  contain?: boolean;
  /** Reports the photo's width/height once loaded, so a detail view can fit it exactly. */
  onAspect?: (ratio: number) => void;
}) {
  return outfit.photo ? (
    <img
      src={img(outfit.photo)}
      alt={outfit.name ?? 'Outfit photo'}
      loading={full ? 'eager' : 'lazy'}
      decoding="async"
      onLoad={(e) => onAspect?.(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
      className={`size-full ${contain ? 'object-contain' : 'object-cover'}`}
    />
  ) : (
    <OutfitStack items={outfit.items} />
  );
}

export function OutfitTile({ outfit, onOpen, caption = true }: { outfit: Outfit; onOpen: () => void; caption?: boolean }) {
  return (
    <motion.button whileTap={{ scale: 0.97 }} transition={spring.snappy} onClick={onOpen} className="flex flex-col text-left">
      <motion.div
        layoutId={`outfit-${outfit.id}`}
        // Photos get a rounded frame; a stack of cutouts floats on the page like the Build rows,
        // so the grid reads as photos and laid-out pieces rather than a wall of identical cards.
        className={`aspect-[3/4] w-full overflow-hidden ${outfit.photo ? 'rounded-md bg-stage' : ''}`}
      >
        <OutfitMedia outfit={outfit} />
      </motion.div>
      {caption && (
        <span className="mt-1.5 flex flex-col items-start gap-1 px-0.5">
          {outfit.name && <span className="block w-full truncate text-label">{outfit.name}</span>}
          <LastWornTag date={outfit.lastWorn} />
        </span>
      )}
    </motion.button>
  );
}

/** The date an outfit was last worn, as a small tag. `short` drops "Last" for narrow tiles. */
export function LastWornTag({ date, short = false }: { date: string | null; short?: boolean }) {
  return (
    <span className={`max-w-full truncate rounded-full px-2 py-0.5 text-caption tabular-nums ${date ? 'bg-stage' : 'border border-line text-muted'}`}>
      {date ? `${short ? 'Worn' : 'Last worn'} ${shortDate(date)}` : 'Not worn yet'}
    </span>
  );
}
