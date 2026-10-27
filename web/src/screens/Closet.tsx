import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CATEGORIES, itemsKey, stylesKey, type Category, type Item, type Person, type PersonId } from '../api';
import { Empty, PrimaryButton } from '../components/Empty';
import { ItemImage } from '../components/ItemImage';
import { ScreenHeader } from '../components/ScreenHeader';
import { spring } from '../lib/motion';
import { useQuery } from '../lib/query';
import { navigate, openOverlay } from '../router';

/** Everything this person can wear (their own plus shared), grouped by category. */
export function Closet({ person }: { person: PersonId }) {
  const { data: items, loading, refresh } = useQuery<Item[]>(itemsKey(person));
  // New pieces swap to their AI version when it's ready (~30 s after adding): check back till then.
  const settling = items?.some((i) => i.status === 'processing' || i.ai?.status === 'processing');
  useEffect(() => {
    if (!settling) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [settling, refresh]);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [style, setStyle] = useState<string | null>(null);
  const { data: styleList } = useQuery<string[]>(stylesKey);

  if (loading) return null;
  const tagged = (items ?? []).filter((i) => i.categories.length);
  const untagged = (items ?? []).filter((i) => !i.categories.length && i.owner === person);
  // Only offer styles that are actually in use, in the order they're listed.
  const inUse = (styleList ?? []).filter((s) => tagged.some((i) => i.styles.includes(s)));
  const shown = style ? tagged.filter((i) => i.styles.includes(style)) : tagged;

  if (!tagged.length && !untagged.length) {
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader title="Closet" />
        <Empty
          title="Add your first piece"
          body="Start with something you wear often. A quick photo is all it takes."
          action={<PrimaryButton onClick={() => navigate(`/${person}/add`)}>Add clothes</PrimaryButton>}
        />
      </div>
    );
  }

  // A piece tagged with several categories appears under each of them.
  const groups = CATEGORIES.map((c) => ({ ...c, items: shown.filter((i) => i.categories.includes(c.id)) }));
  const visible = groups.filter((g) => g.items.length && (filter === 'all' || g.id === filter));
  const firstSection = new Map<number, Category>();
  for (const g of visible) for (const i of g.items) if (!firstSection.has(i.id)) firstSection.set(i.id, g.id);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Closet">
        <span className="text-label text-muted tabular-nums">
          {tagged.length} {tagged.length === 1 ? 'piece' : 'pieces'}
        </span>
      </ScreenHeader>

      <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto px-4 pb-2 rail:px-7" role="tablist">
        {[{ id: 'all' as const, label: 'All', count: shown.length }, ...groups.map((g) => ({ id: g.id, label: g.label, count: g.items.length }))].map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            disabled={f.count === 0}
            onClick={() => setFilter(f.id)}
            className={`relative min-h-tap shrink-0 rounded-full px-4 text-label transition-colors disabled:opacity-35 ${
              filter === f.id ? 'text-on-ink' : 'text-ink'
            }`}
          >
            {filter === f.id && (
              <motion.span layoutId="closet-filter" transition={spring.snappy} className="absolute inset-0 rounded-full bg-ink" />
            )}
            <span className="relative">{f.label}</span>
          </button>
        ))}
      </div>

      {inUse.length > 0 && (
        <div className="no-scrollbar -mt-1 flex shrink-0 gap-1 overflow-x-auto px-4 pb-2 rail:px-7" role="group" aria-label="Style">
          {[null, ...inUse].map((s) => (
            <button
              key={s ?? 'any'}
              onClick={() => setStyle(s)}
              aria-pressed={style === s}
              className={`relative min-h-tap shrink-0 rounded-full px-3 text-caption transition-colors ${
                style === s ? 'text-ink' : 'text-muted'
              }`}
            >
              {style === s && (
                <motion.span layoutId="closet-style" transition={spring.snappy} className="absolute inset-x-2 bottom-2 h-px bg-ink" />
              )}
              {s ?? 'Any style'}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-8 rail:px-7">
        {untagged.length > 0 && (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-line px-4 py-2">
            <p className="flex-1 text-label">
              {untagged.length} {untagged.length === 1 ? 'piece needs' : 'pieces need'} a category
            </p>
            <button
              onClick={() => navigate(`/${person}/add?tag=untagged`)}
              className="min-h-tap px-2 text-label font-medium text-accent"
            >
              Tag them
            </button>
          </div>
        )}

        {/* A piece in several categories shows in each section; only its first carries the
            shared-element id (duplicate layoutIds hide each other). */}
        {visible.map((g) => (
          <section key={g.id} className="mb-8">
            <h2 className="mb-2 flex items-baseline gap-2 px-1 text-label font-medium">
              {g.label} <span className="text-caption text-muted tabular-nums">{g.items.length}</span>
            </h2>
            {/* One quiet surface per category; pieces float on it rather than sitting in boxes. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-2 gap-y-1 rounded-lg bg-stage p-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-x-4 sm:p-5">
              {g.items.map((item) => (
                <ClosetPiece key={item.id} item={item} person={person} hero={firstSection.get(item.id) === g.id} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ClosetPiece({ item, person, hero }: { item: Item; person: PersonId; hero: boolean }) {
  const borrowed = item.owner !== person;
  const { data: people } = useQuery<Person[]>('/people');
  const owner = people?.find((p) => p.id === item.owner)?.name;
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      transition={spring.snappy}
      onClick={() => openOverlay('item', item.id)}
      className="relative flex aspect-square items-center justify-center p-2"
      aria-label={item.name ?? `${item.categories.join(', ')}${item.shared ? ', shared' : ''}`}
    >
      <ItemImage item={item} layoutId={hero ? `item-${item.id}` : undefined} />
      {item.shared && (
        <span
          className="absolute right-1 top-1 text-muted"
          title={borrowed ? `Shared by ${owner ?? 'someone else'}` : 'Shared'}
        >
          <Users size={13} strokeWidth={1.8} />
        </span>
      )}
    </motion.button>
  );
}
