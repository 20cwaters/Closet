import type { Transition } from 'framer-motion';

/** Springs shared across the app so every motion feels like the same physical world. */
export const spring = {
  /** Default UI response: quick, no wobble. */
  snappy: { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 },
  /** Things that move a long way (detail views, sheets). */
  glide: { type: 'spring', stiffness: 320, damping: 34, mass: 1 },
  /** A small, satisfying overshoot (shuffle settle, lock toggle, save confirm). */
  settle: { type: 'spring', stiffness: 260, damping: 20, mass: 0.9 },
} satisfies Record<string, Transition>;
