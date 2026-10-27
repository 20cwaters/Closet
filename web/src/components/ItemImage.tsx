import { motion } from 'framer-motion';
import type { CSSProperties, SyntheticEvent } from 'react';
import { img, type Item } from '../api';

/**
 * A garment image sized to fit its box. Cutouts float with a contact shadow; items whose
 * background couldn't be removed (or isn't yet) show the photo itself with rounded corners.
 * Thumbnails are lazy-loaded; `full` loads the large cutout for detail views.
 */
export function ItemImage({
  item,
  full = false,
  layoutId,
  className = '',
  style,
  onLoad,
}: {
  item: Item;
  full?: boolean;
  layoutId?: string;
  className?: string;
  style?: CSSProperties;
  onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void;
}) {
  const isCutout = item.status === 'ready' && !!item.cutout;
  const src = full ? (item.cutout ?? item.original) : (item.thumb ?? item.original);
  return (
    <motion.img
      layoutId={layoutId}
      src={img(src)}
      alt={item.name ?? ''}
      loading={full ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      style={style}
      onLoad={onLoad}
      className={`max-h-full max-w-full ${isCutout ? 'cutout' : 'rounded-sm object-contain'} ${className}`}
    />
  );
}
