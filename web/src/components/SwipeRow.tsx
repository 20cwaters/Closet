import {
  animate,
  motion,
  useMotionValue,
  useScroll,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from 'framer-motion';
import { Lock, LockOpen, Plus } from 'lucide-react';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Item } from '../api';
import { prefersReducedMotion } from '../lib/device';
import { spring } from '../lib/motion';
import { ItemImage } from './ItemImage';

export interface Card {
  key: string;
  /** null = the "None" card (headwear, outerwear) */
  item: Item | null;
}

export interface RowHandle {
  /** Spin to a card with a spring, after `delay` ms. Resolves once it has settled. */
  spinTo: (index: number, delay?: number) => Promise<void>;
}

const NEIGHBOR_SCALE = 0.6;

/**
 * One horizontally swiping row. The card in the middle is the selected one; neighbours
 * shrink and fade with distance. All of that is driven by scroll position through motion
 * values, so swiping never re-renders React.
 */
export function SwipeRow({
  label,
  labelExtra,
  cards,
  index,
  onSettle,
  locked,
  onToggleLock,
  onOpen,
  emptyLabel,
  onEmpty,
  heroIndex,
  grow = 1,
  fit,
  ref,
}: {
  label: string;
  /** Shown beside the row's name (e.g. "+ Layer"). */
  labelExtra?: ReactNode;
  cards: Card[];
  index: number;
  onSettle: (index: number) => void;
  locked: boolean;
  onToggleLock: () => void;
  onOpen: (item: Item) => void;
  emptyLabel: string;
  onEmpty: () => void;
  /**
   * The one card that carries the shared-element id for the detail transition. A piece can
   * show in several rows (layers, multi-category), and duplicate layoutIds hide each other.
   */
  heroIndex: number | null;
  /** Share of the screen's height this row gets, relative to the others. */
  grow?: number;
  /**
   * Size pieces to scale instead of filling the row: given a piece's height ÷ width, the
   * share of the row's height it gets. Such rows also hang their pieces from the top.
   */
  fit?: (aspect: number) => number;
  ref?: Ref<RowHandle>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // The selected piece fills the row's height. Slots run a little wider than tall so wide
  // pieces (jackets, a pair of shoes) fill it too; the neighbours just peek in at the sides.
  const slot = Math.round(Math.min(box.h * 1.45, box.w * 0.72));
  const { scrollX } = useScroll({ container: scroller });
  const dim = useMotionValue(locked ? 1 : 0);
  const busy = useRef(false);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  // Read by the scroll handler, which can fire before effects re-subscribe after a resize.
  const slotRef = useRef(slot);
  slotRef.current = slot;
  /** Scroll events before this time come from our own repositioning, not a swipe. */
  const quietUntil = useRef(0);

  useLayoutEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the scroll position on the selected card when it changes from outside or the row resizes.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !slot || busy.current) return;
    const target = index * slot;
    if (Math.abs(el.scrollLeft - target) > 1) {
      quietUntil.current = performance.now() + 250;
      el.scrollLeft = target;
    }
  }, [index, slot, cards.length]);

  // Locked rows fade their neighbours further, so the pinned piece stands out.
  useEffect(() => {
    const c = animate(dim, locked ? 1 : 0, spring.snappy);
    return () => c.stop();
  }, [locked, dim]);

  // Report the centred card once a swipe settles.
  useEffect(() => {
    const el = scroller.current!;
    let t = 0;
    const settle = () => {
      const s = slotRef.current;
      if (busy.current || !s || performance.now() < quietUntil.current) return;
      const i = Math.max(0, Math.min(cards.length - 1, Math.round(el.scrollLeft / s)));
      if (i !== indexRef.current) onSettle(i);
    };
    const onScroll = () => {
      clearTimeout(t);
      t = window.setTimeout(settle, 120);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', settle);
    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', settle);
    };
  }, [cards.length, onSettle]);

  const stopSpin = () => {
    if (!busy.current) return;
    anim.current?.stop();
    const el = scroller.current!;
    el.style.scrollSnapType = '';
    busy.current = false;
  };

  useImperativeHandle(ref, () => ({
    spinTo(i, delay = 0) {
      const el = scroller.current;
      if (!el || !slot) return Promise.resolve();
      anim.current?.stop();
      const to = i * slot;
      if (prefersReducedMotion()) {
        el.scrollLeft = to;
        return Promise.resolve();
      }
      busy.current = true;
      el.style.scrollSnapType = 'none'; // snapping would fight the animation
      return new Promise<void>((resolve) => {
        anim.current = animate(el.scrollLeft, to, {
          ...spring.settle,
          stiffness: 110,
          damping: 15,
          delay: delay / 1000,
          restDelta: 0.5,
          onUpdate: (v) => (el.scrollLeft = v),
          onComplete: () => {
            el.style.scrollSnapType = '';
            el.scrollLeft = to;
            busy.current = false;
            resolve();
          },
        });
      });
    },
  }), [slot]);

  const pad = Math.max(0, (box.w - slot) / 2);
  // No real pieces yet (headwear still has its None card): offer to add some.
  const empty = cards.every((c) => !c.item);

  return (
    <div className="relative min-h-0 min-w-0 flex-1" style={{ flexGrow: grow }}>
      <div
        ref={scroller}
        onPointerDown={stopSpin}
        className={`no-scrollbar flex h-full snap-x snap-mandatory items-stretch ${locked ? 'overflow-hidden' : 'overflow-x-auto'}`}
        style={{ overscrollBehaviorX: 'contain' }}
      >
        <div className="shrink-0" style={{ width: pad }} />
        {slot > 0 && cards.map((card, i) => (
          <Slot
            key={card.key}
            card={card}
            i={i}
            slot={slot}
            height={box.h}
            fit={fit}
            scrollX={scrollX}
            dim={dim}
            hero={i === heroIndex}
            onTap={() => {
              if (i === indexRef.current) {
                if (card.item) onOpen(card.item);
              } else {
                scroller.current?.scrollTo({ left: i * slot, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
              }
            }}
          />
        ))}
        {empty ? (
          <button
            onClick={onEmpty}
            className="flex shrink-0 snap-center flex-col items-center justify-center gap-1 text-label text-muted"
            style={{ width: slot }}
          >
            <span className="grid size-11 place-items-center rounded-full border border-dashed border-line">
              <Plus size={18} />
            </span>
            {emptyLabel}
          </button>
        ) : null}
        <div className="shrink-0" style={{ width: pad }} />
      </div>
      {/* The row's name doubles as its lock: "Tops 🔓" → tap → "Tops 🔒". */}
      <div className="absolute left-2 top-0 z-10 flex items-center rail:left-5">
      {cards.some((c) => c.item) ? (
        <motion.button
          onClick={onToggleLock}
          whileTap={{ scale: 0.92 }}
          transition={spring.settle}
          aria-pressed={locked}
          aria-label={locked ? `Unlock ${label.toLowerCase()}` : `Lock ${label.toLowerCase()}`}
          className={`flex min-h-11 items-center gap-1.5 rounded-full px-3 text-caption transition-colors ${
            locked ? 'bg-accent text-paper' : 'text-muted'
          }`}
        >
          {label}
          <motion.span key={String(locked)} initial={{ rotate: locked ? -25 : 25, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={spring.settle}>
            {locked ? <Lock size={14} strokeWidth={2.2} /> : <LockOpen size={14} strokeWidth={1.6} />}
          </motion.span>
        </motion.button>
      ) : (
        <span className="pointer-events-none flex min-h-11 items-center px-3 text-caption text-muted">
          {label}
        </span>
      )}
      {labelExtra}
      </div>
    </div>
  );
}

function Slot({ card, i, slot, height, fit, scrollX, dim, hero, onTap }: {
  card: Card;
  hero: boolean;
  i: number;
  slot: number;
  height: number;
  fit?: (aspect: number) => number;
  scrollX: MotionValue<number>;
  dim: MotionValue<number>;
  onTap: () => void;
}) {
  const c = i * slot;
  // Measured from the image once it loads; until then it stays hidden so it doesn't jump.
  const [aspect, setAspect] = useState<number | null>(null);
  const scale = useTransform(scrollX, [c - slot, c, c + slot], [NEIGHBOR_SCALE, 1, NEIGHBOR_SCALE]);
  const opacity = useTransform([scrollX, dim], ([x, d]: number[]) => {
    const dist = Math.min(Math.abs(x - c) / slot, 1);
    return (1 - 0.7 * dist) * (1 - 0.75 * d * dist);
  });
  return (
    <motion.button
      onClick={onTap}
      // Padding in px: a % here would resolve against the whole scroller's width.
      style={{ width: slot, padding: `${Math.round(height * 0.03)}px ${Math.round(slot * 0.03)}px`, scale, opacity }}
      className={`flex shrink-0 snap-center justify-center will-change-transform ${fit && card.item ? 'items-start' : 'items-center'}`}
      aria-label={card.item ? (card.item.name ?? card.item.categories[0] ?? 'item') : 'None'}
    >
      {card.item ? (
        <ItemImage
          item={card.item}
          layoutId={hero ? `item-${card.item.id}` : undefined}
          onLoad={fit ? (e) => setAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth) : undefined}
          style={
            fit
              ? aspect === null
                ? { opacity: 0 }
                : { maxHeight: `${Math.round(fit(aspect) * 100)}%`, transition: 'opacity 150ms', opacity: 1 }
              : undefined
          }
        />
      ) : (
        <span className="grid aspect-square h-1/2 max-h-28 place-items-center rounded-full border border-line text-label text-muted">
          None
        </span>
      )}
    </motion.button>
  );
}
