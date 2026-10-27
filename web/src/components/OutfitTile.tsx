import { motion } from 'framer-motion';
import { img, type Outfit } from '../api';
import { relativeDay } from '../lib/dates';
import { spring } from '../lib/motion';
import { OutfitStack } from './OutfitStack';

/** Photo-first: the outfit photo when there is one, otherwise the composed stack. */
export function OutfitMedia({ outfit, full = false, onAspect }: {
  outfit: Outfit;
  full?: boolean;
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
      className="size-full object-cover"
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
      {/* Only say something when there's something to say: a name, or when it was last worn. */}
      {caption && (outfit.name || outfit.lastWorn) && (
        <span className="mt-1.5 px-0.5">
          {outfit.name && <span className="block truncate text-label">{outfit.name}</span>}
          {outfit.lastWorn && <span className="block text-caption text-muted">Worn {relativeDay(outfit.lastWorn)}</span>}
        </span>
      )}
    </motion.button>
  );
}
