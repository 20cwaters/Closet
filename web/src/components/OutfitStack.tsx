import { img, type Category, type Item } from '../api';

/**
 * An outfit without a photo, composed head to toe from its cutouts, like pieces laid out
 * on a bed. Outerwear and tops (layers included) share the upper band side by side.
 */
export function OutfitStack({ items, className = '' }: { items: (Item & { slot?: Category | null })[]; className?: string }) {
  const of = (c: Category) => items.filter((i) => (i.slot ?? i.categories[0]) === c);
  const upper = [...of('outerwear'), ...of('top')].slice(0, 4);
  const bands = [
    { items: of('headwear').slice(0, 1), h: 16 },
    { items: upper, h: 34 },
    { items: of('bottom').slice(0, 1), h: 34 },
    { items: of('shoes').slice(0, 1), h: 16 },
  ].filter((b) => b.items.length);
  const total = bands.reduce((s, b) => s + b.h, 0) || 1;

  return (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-[3%] p-[8%] ${className}`}>
      {bands.map((band, i) => (
        <div key={i} className="flex min-h-0 w-full items-center justify-center gap-[4%]" style={{ height: `${(band.h / total) * 88}%` }}>
          {band.items.map((item) => (
            <img
              key={item.id}
              src={img(item.thumb ?? item.original)}
              alt=""
              loading="lazy"
              decoding="async"
              className={`h-full min-w-0 object-contain ${item.cutout ? 'cutout' : 'rounded-sm'}`}
              style={{ maxWidth: band.items.length > 1 ? `${Math.floor(96 / band.items.length)}%` : '90%' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
