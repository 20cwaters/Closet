import {
  CATEGORIES,
  rules,
  suitsTemperature,
  type Category,
  type Temperature,
  type WeatherTag,
} from './rules.js';

/**
 * The daily suggestion. Pure and deterministic: the same inputs on the same day give the
 * same pick (seeded by person + date), so the tablet shows one answer all day.
 */

export interface SItem {
  id: number;
  /** Rows the piece can go in (an overshirt can be a top and outerwear). */
  categories: Category[];
  weather: WeatherTag[];
  /** Most recent day this person wore it, *before* today (YYYY-MM-DD), or null. */
  lastWorn: string | null;
  /** A dress (tagged as a top): worn without bottoms or outerwear. */
  dress?: boolean;
  /** Style tags (Casual, Work…): an assembled outfit sticks to one of them where it can. */
  styles?: string[];
}

export interface SOutfit {
  id: number;
  /** Pieces in the row they were saved in, in layer order. */
  pieces: { id: number; slot: Category }[];
}

export interface SuggestInput {
  person: string;
  date: string;
  /** Today's conditions: a temperature, plus 'rainy' / 'windy' when they apply. */
  conditions: WeatherTag[];
  needsOuterwear: boolean;
  items: SItem[];
  outfits: SOutfit[];
  /** false = ignore the weather entirely (rules.useWeather); default true. */
  useWeather?: boolean;
}

/** Item ids per row, in layer order. An empty list = nothing (for headwear: None). */
export type Selection = Record<Category, number[]>;

export interface Suggestion {
  date: string;
  /** 'outfit' = a saved outfit; 'pieces' = assembled from individual items. */
  source: 'outfit' | 'pieces' | 'empty';
  outfitId: number | null;
  selected: Selection;
  showOuterwear: boolean;
}

/** Days with no wear history count as this fresh (so "never worn" ranks first). */
const NEVER = 60;

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** mulberry32 seeded from an FNV-1a hash of the string. */
export function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const emptySelection = (): Selection => ({ headwear: [], outerwear: [], top: [], bottom: [], shoes: [] });

export function suggest(input: SuggestInput): Suggestion {
  const { date, items } = input;
  const useWeather = input.useWeather ?? true;
  const needsOuterwear = useWeather && input.needsOuterwear;
  const rand = seededRandom(`${input.person}:${date}`);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const temp = (input.conditions.find((c) => ['hot', 'warm', 'cool', 'cold'].includes(c)) ?? 'cool') as Temperature;
  const extras = useWeather ? input.conditions.filter((c) => c === 'rainy' || c === 'windy') : [];

  // A piece rests (or rotates) by the strictest window among the rows it can go in.
  const window = (i: SItem) => Math.max(0, ...i.categories.map((c) => rules.recencyDays[c]));
  const rotates = (i: SItem) => window(i) > 0;
  const freshness = (i: SItem) =>
    !rotates(i) || !i.lastWorn ? NEVER : Math.min(daysBetween(i.lastWorn, date), NEVER);
  const rested = (i: SItem) => !i.lastWorn || daysBetween(i.lastWorn, date) > window(i);
  const suits = (i: SItem) => !useWeather || suitsTemperature(i.weather, temp);
  // On a rainy/windy day, pieces tagged for it go first.
  const preferred = (i: SItem) => extras.some((e) => i.weather.includes(e));
  const byFresh = (a: SItem, b: SItem) => freshness(b) - freshness(a) || a.id - b.id;

  const used = new Set<number>();
  /** The outfit's style, set from the top it starts with: the other pieces follow it where they can. */
  let style: string | null = null;
  const styled = (i: SItem) => !style || !!i.styles?.includes(style);
  /**
   * One piece for a row: the strictest rule tier that has anything, then the least recently
   * worn half. Style gives way before the weather and rotation rules do.
   */
  const pickPiece = (category: Category, extra: (i: SItem) => boolean = () => true): number[] => {
    const inCat = items.filter((i) => i.categories.includes(category) && !used.has(i.id) && extra(i));
    const tiers = [
      extras.length ? inCat.filter((i) => styled(i) && rested(i) && suits(i) && preferred(i)) : [],
      inCat.filter((i) => styled(i) && rested(i) && suits(i)),
      extras.length ? inCat.filter((i) => rested(i) && suits(i) && preferred(i)) : [],
      inCat.filter((i) => rested(i) && suits(i)),
      inCat.filter(rested),
      inCat,
    ];
    const tier = tiers.find((t) => t.length);
    if (!tier) return [];
    const ranked = [...tier].sort(byFresh);
    const shortlist = rules.recencyDays[category] > 0
      ? ranked.slice(0, Math.min(5, Math.max(1, Math.ceil(ranked.length / 2))))
      : ranked;
    const chosen = pick(shortlist);
    used.add(chosen.id);
    return [chosen.id];
  };

  // 1. A saved outfit where every piece passes the rules, favouring the least recently worn.
  const byId = new Map(items.map((i) => [i.id, i]));
  const candidates = input.outfits
    .map((o) => ({ o, pieces: o.pieces.map((p) => ({ ...p, item: byId.get(p.id) })) }))
    .filter((c) => c.pieces.length > 0 && c.pieces.every((p) => p.item && rested(p.item) && suits(p.item)))
    .map(({ o, pieces }) => {
      const its = pieces.map((p) => p.item!);
      return {
        o,
        score:
          its.reduce((s, p) => s + freshness(p), 0) / its.length +
          (extras.length ? (10 * its.filter(preferred).length) / its.length : 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.o.id - b.o.id);

  if (candidates.length) {
    const chosen = pick(candidates.slice(0, rules.outfitShortlist)).o;
    const selected = emptySelection();
    for (const p of chosen.pieces) {
      selected[p.slot].push(p.id);
      used.add(p.id);
    }
    const withDress = chosen.pieces.some((p) => byId.get(p.id)?.dress);
    if (needsOuterwear && !selected.outerwear.length && !withDress) selected.outerwear = pickPiece('outerwear');
    return {
      date,
      source: 'outfit',
      outfitId: chosen.id,
      selected,
      showOuterwear: needsOuterwear || selected.outerwear.length > 0,
    };
  }

  // 2. Otherwise assemble one, row by row, with the same rules (never the same piece twice).
  const selected = emptySelection();
  selected.top = pickPiece('top');
  const top = byId.get(selected.top[0]);
  if (top?.styles?.length) style = pick(top.styles);
  // A dress goes on its own: no bottoms, no outerwear (the row still shows, on None).
  const dress = !!top?.dress;
  if (!dress) selected.bottom = pickPiece('bottom');
  selected.shoes = pickPiece('shoes');
  if (needsOuterwear && !dress) selected.outerwear = pickPiece('outerwear');
  if (useWeather && temp === 'cold' && rules.hatWhenCold) {
    const coldHat = (i: SItem) => i.weather.includes('cold');
    if (items.some((i) => i.categories.includes('headwear') && coldHat(i) && rested(i)))
      selected.headwear = pickPiece('headwear', coldHat);
  }
  const any = CATEGORIES.some((c) => selected[c].length);
  return {
    date,
    source: any ? 'pieces' : 'empty',
    outfitId: null,
    selected,
    showOuterwear: needsOuterwear,
  };
}
