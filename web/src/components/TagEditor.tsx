import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  CATEGORIES,
  stylesKey,
  WEATHER,
  type Category,
  type Item,
  type Person,
  type WeatherTag,
} from '../api';
import { updateItem, type ItemPatch } from '../lib/items';
import { sharedWith } from '../lib/person';
import { setQueryData, useQuery } from '../lib/query';
import { Chip, MultiChoice, Toggle } from './Toggle';

const ALL_WEATHER = WEATHER.map((w) => w.id);

/**
 * Every tag on a piece: what it is, the weather it suits, its styles, and sharing.
 * Each tag type takes any number of values. Taps update at once and save shortly after,
 * so quick tapping never loses a change.
 */
export function TagEditor({ item, showShare = true, onCategories }: {
  item: Item;
  showShare?: boolean;
  /** Called as soon as categories change locally (before the save lands). */
  onCategories?: (c: Category[]) => void;
}) {
  const { data: people } = useQuery<Person[]>('/people');
  const others = sharedWith(people, item.owner);
  const [tags, setTags] = useState({ categories: item.categories, weather: item.weather, styles: item.styles, dress: item.dress });
  const pending = useRef<ItemPatch>({});
  const timer = useRef(0);

  // A different piece (tagging flow "Next") starts from its own tags.
  useEffect(() => {
    setTags({ categories: item.categories, weather: item.weather, styles: item.styles, dress: item.dress });
  }, [item.id]);

  const flush = () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) updateItem(item.id, patch).catch((e) => alert(e.message));
  };
  useEffect(() => flush, [item.id]); // save anything pending when moving on

  const change = <K extends keyof typeof tags>(key: K, value: (typeof tags)[K]) => {
    setTags((t) => ({ ...t, [key]: value }));
    if (key === 'categories') onCategories?.(value as Category[]);
    pending.current = { ...pending.current, [key]: value };
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 300);
  };

  const allWeather = ALL_WEATHER.every((w) => tags.weather.includes(w));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-label text-muted">What is it?</p>
        <MultiChoice<Category>
          label="Category"
          options={CATEGORIES.map((c) => ({ id: c.id, label: c.one }))}
          value={tags.categories}
          onChange={(v) => change('categories', v)}
        />
        {tags.categories.includes('top') && (
          <div className="mt-2">
            <Toggle
              on={tags.dress}
              onChange={(v) => change('dress', v)}
              label="It's a dress"
              hint="Outfits with it skip bottoms and outerwear"
            />
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-label text-muted">
            Weather <span className="text-caption">{tags.weather.length ? '' : '· any if none chosen'}</span>
          </p>
          <button
            onClick={() => change('weather', allWeather ? [] : ALL_WEATHER)}
            className="-my-3 min-h-tap px-1 text-label text-accent"
          >
            {allWeather ? 'Clear' : 'All weather'}
          </button>
        </div>
        <MultiChoice<WeatherTag> label="Weather" options={WEATHER} value={tags.weather} onChange={(v) => change('weather', v)} />
      </div>

      <div>
        <p className="mb-2 text-label text-muted">Style</p>
        <StylePicker value={tags.styles} onChange={(v) => change('styles', v)} />
      </div>

      {showShare && others && (
        <Toggle
          on={item.shared}
          onChange={(shared) => updateItem(item.id, { shared }).catch((e) => alert(e.message))}
          label={`Share with ${others}`}
          hint="Shows up in both closets"
        />
      )}
    </div>
  );
}

/** Styles as wrapping chips, plus "Add style" that turns into a text field in place. */
function StylePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data: styles } = useQuery<string[]>(stylesKey);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const save = async () => {
    const name = draft.trim();
    setAdding(false);
    setDraft('');
    if (!name) return;
    const list = await api.post<string[]>('/styles', { name });
    setQueryData(stylesKey, () => list);
    const added = list.find((s) => s.toLowerCase() === name.toLowerCase());
    if (added && !value.includes(added)) onChange([...value, added]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {(styles ?? []).map((s) => (
        <Chip key={s} on={value.includes(s)} onClick={() => onChange(value.includes(s) ? value.filter((v) => v !== s) : [...value, s])}>
          {s}
        </Chip>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          maxLength={24}
          placeholder="Style name"
          aria-label="New style name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="min-h-12 w-36 rounded-md border border-line bg-paper px-3 text-label focus:outline-none focus:ring-2 focus:ring-accent"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex min-h-12 items-center gap-1.5 rounded-md border border-dashed border-line px-3 text-label text-muted"
        >
          <Plus size={16} /> Add style
        </button>
      )}
    </div>
  );
}

/** A short summary of a piece's tags, e.g. "Top, Outerwear · cool, windy". */
export function tagSummary(item: Item) {
  const cats = item.categories.map((c) => CATEGORIES.find((x) => x.id === c)!.one).join(', ');
  const weather = item.weather.length === WEATHER.length ? 'all weather' : item.weather.join(', ');
  return [cats, weather].filter(Boolean).join(' · ');
}
