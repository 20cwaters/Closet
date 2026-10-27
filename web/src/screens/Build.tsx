import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, BookmarkCheck, Camera, Check, ChevronRight, Images, ListFilter, Pencil, Plus, Shuffle, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  api,
  CATEGORIES,
  img,
  itemsKey,
  LAYERED,
  MAX_LAYERS,
  outfitsKey,
  stylesKey,
  suggestionKey,
  suitsTemperature,
  wornKey,
  type Category,
  type Item,
  type Outfit,
  type PersonId,
  type Suggestion,
} from '../api';
import { Empty, PrimaryButton } from '../components/Empty';
import { MusicStrip } from '../components/Music';
import { ScreenHeader } from '../components/ScreenHeader';
import { Sheet } from '../components/Sheet';
import { SwipeRow, type Card, type RowHandle } from '../components/SwipeRow';
import { Toast, type ToastMessage } from '../components/Toast';
import { WEATHER_MAX_AGE, type Weather } from '../components/WeatherLine';
import { getBuild, setBuild, useBuild, type BuildState, type Picks } from '../lib/buildState';
import { localToday } from '../lib/dates';
import { useRail } from '../lib/device';
import { spring } from '../lib/motion';
import { uploadOutfitPhoto, wearToday } from '../lib/outfits';
import { invalidate, useQuery } from '../lib/query';
import { navigate, openOverlay, setParam, useLocation } from '../router';

/** `grow`: each row's share of the height; the big pieces get the most. */
const ROW_TYPES: { id: Category; label: string; empty: string; grow: number }[] = [
  { id: 'headwear', label: 'Headwear', empty: 'Add headwear', grow: 0.7 },
  { id: 'outerwear', label: 'Outerwear', empty: 'Add outerwear', grow: 1 },
  { id: 'top', label: 'Tops', empty: 'Add tops', grow: 1.05 },
  { id: 'bottom', label: 'Bottoms', empty: 'Add bottoms', grow: 1.25 },
  { id: 'shoes', label: 'Shoes', empty: 'Add shoes', grow: 0.75 },
];
/**
 * Bottoms are sized by width rather than height: laid flat, shorts, skirts and jeans are all
 * about as wide, so shorts come out short instead of blown up to the height of jeans. A piece
 * at least 1 / 0.6 ≈ 1.7 times taller than wide (most full-length pants) fills the row.
 */
const fitBottom = (aspect: number) => Math.min(1, aspect * 0.6);

/** Rows that start with a "None" card: no hat, no jacket, or no bottoms (with a dress). */
const OPTIONAL: Category[] = ['headwear', 'outerwear', 'bottom'];

/** One swipe row: a category, and which layer of it (tops and outerwear can stack). */
interface Row {
  key: string;
  category: Category;
  layer: number;
  label: string;
  empty: string;
  grow: number;
}

const sameSet = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();

export function Build({ person }: { person: PersonId }) {
  const { params } = useLocation();
  const rail = useRail();
  const { data: items, loading } = useQuery<Item[]>(itemsKey(person));
  const { data: weather } = useQuery<Weather>('/weather', { maxAge: WEATHER_MAX_AGE });
  const day = localToday();
  // The date in the key means a tablet left running loads a fresh pick each morning.
  const { data: suggestion } = useQuery<Suggestion>(`${suggestionKey(person)}&day=${day}`);
  const { data: outfits } = useQuery<Outfit[]>(outfitsKey(person));
  const { data: worn } = useQuery<{ date: string; itemIds: number[] }>(wornKey(person));
  const state = useBuild(person);
  const rowRefs = useRef<Record<string, RowHandle | null>>({});
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [photoFor, setPhotoFor] = useState<Outfit | null>(null);
  const [busy, setBusy] = useState<'save' | 'wear' | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const { data: styleList } = useQuery<string[]>(stylesKey);

  // A piece tagged with several categories shows up in each of those rows.
  const cards = useMemo(() => {
    const out = {} as Record<Category, Card[]>;
    for (const r of ROW_TYPES) {
      const pieces = (items ?? []).filter((i) => i.categories.includes(r.id));
      out[r.id] = [
        ...(OPTIONAL.includes(r.id) ? [{ key: 'none', item: null }] : []),
        ...pieces.map((item) => ({ key: String(item.id), item })),
      ];
    }
    return out;
  }, [items]);

  // Unless toggled, the outerwear row follows today's pick (which decides whether weather counts).
  const showOuterwear = state.outerwear ?? suggestion?.showOuterwear ?? false;
  const rows: Row[] = ROW_TYPES.filter((r) => r.id !== 'outerwear' || showOuterwear).flatMap((r) => {
    const layers = LAYERED.includes(r.id) ? Math.max(1, state.selected[r.id]?.length ?? 1) : 1;
    const one = CATEGORIES.find((c) => c.id === r.id)!.one;
    return Array.from({ length: layers }, (_, layer) => ({
      key: `${r.id}:${layer}`,
      category: r.id,
      layer,
      label: layer === 0 ? r.label : `${one} ${layer + 1}`,
      empty: r.empty,
      grow: r.grow,
    }));
  });

  const indexIn = useCallback(
    (c: Category, picks: Picks, layer: number) => {
      const sel = picks[c]?.[layer] ?? null;
      const i = cards[c].findIndex((k) => (k.item?.id ?? null) === sel);
      return i < 0 ? 0 : i;
    },
    [cards],
  );
  const indexOf = (r: Row) => indexIn(r.category, state.selected, r.layer);
  const itemAt = (r: Row) => cards[r.category][indexOf(r)]?.item ?? null;

  // "Build around this": arrive with one piece locked in (the first of) its rows.
  useEffect(() => {
    const id = Number(params.get('around'));
    if (!id || !items) return;
    const item = items.find((i) => i.id === id);
    const c = item?.categories[0];
    if (item && c) {
      setBuild(person, (s) => ({
        selected: { ...s.selected, [c]: [item.id, ...(s.selected[c] ?? []).slice(1)] },
        locked: [...new Set([...s.locked, `${c}:0`])],
        outerwear: c === 'outerwear' ? true : s.outerwear,
        seeded: day,
      }));
    }
    setParam('around', null, { replace: true });
  }, [params, items, person, day]);

  // Back from Spotify sign-in: say how it went, then tidy the URL.
  useEffect(() => {
    const result = params.get('spotify');
    if (!result) return;
    const text =
      result === 'connected'
        ? 'Spotify connected'
        : result === 'not_allowed'
          ? 'Spotify said no: add this account under User Management in your Spotify developer app'
          : result === 'cancelled'
            ? 'Spotify wasn’t connected'
            : 'Couldn’t connect Spotify. Try again.';
    setToast({ id: Date.now(), text });
    invalidate('/spotify/');
    setParam('spotify', null, { replace: true });
  }, [params]);

  // Fill the rows with today's pick, once per day (unless something else already did).
  useEffect(() => {
    if (!suggestion || params.has('around') || getBuild(person).seeded === day) return;
    setBuild(person, () => ({
      selected: { ...suggestion.selected },
      outerwear: suggestion.showOuterwear ? true : null,
      locked: [],
      seeded: day,
      editing: null,
    }));
  }, [suggestion, params, person, day]);

  // What's on screen, row by row (a piece showing in two rows counts once).
  const pieces = (() => {
    const seen = new Set<number>();
    return rows.flatMap((r) => {
      const item = itemAt(r);
      if (!item || seen.has(item.id)) return [];
      seen.add(item.id);
      return [{ id: item.id, slot: r.category }];
    });
  })();
  const combo = pieces.map((p) => p.id);
  const saved = outfits?.find((o) => sameSet(o.items.map((i) => i.id), combo));
  const editing = state.editing && outfits?.find((o) => o.id === state.editing!.id);
  const asSaved = (o: Outfit) => o.items.map((i) => `${i.id}:${i.slot}`).join();
  const unchanged = !!editing && asSaved(editing) === pieces.map((p) => `${p.id}:${p.slot}`).join();
  const wornToday = combo.length > 0 && combo.every((id) => worn?.itemIds.includes(id));

  const isDress = (id: number | null | undefined) => !!id && !!cards.top.find((k) => k.item?.id === id)?.item?.dress;
  /** A dress goes on its own: bottoms and outerwear (unless locked) to None. */
  const dressOff = (): Picks => ({
    ...(state.locked.includes('bottom:0') ? {} : { bottom: [null] }),
    ...(state.locked.some((k) => k.startsWith('outerwear:')) ? {} : { outerwear: [null] }),
  });

  const onSettle = (r: Row, i: number) => {
    const id = cards[r.category][i]?.item?.id ?? null;
    const tops = [...(state.selected.top ?? [])];
    if (r.category === 'top') tops[r.layer] = id;
    setBuild(person, (s) => {
      const list = [...(s.selected[r.category] ?? [])];
      list[r.layer] = id;
      return { selected: { ...s.selected, [r.category]: list } };
    });
    if (r.category !== 'top') return;
    const wasDress = (state.selected.top ?? []).some(isDress);
    const nowDress = tops.some(isDress);
    if (nowDress && !wasDress) {
      spinTo(dressOff(), {
        beforeDress: { bottom: state.selected.bottom ?? [], outerwear: state.selected.outerwear ?? [] },
      });
    } else if (!nowDress && wasDress && state.beforeDress) {
      // Swiped off the dress: put back what it cleared, if still on None.
      const back: Picks = {};
      const before = state.beforeDress;
      if (!state.selected.bottom?.some((x) => x !== null) && before.bottom?.some((x) => x !== null)) back.bottom = before.bottom;
      if (!state.selected.outerwear?.some((x) => x !== null) && before.outerwear?.some((x) => x !== null))
        back.outerwear = before.outerwear;
      spinTo(back, { beforeDress: null });
    }
  };

  /** Move rows to a new selection, spinning each changed row in turn (top to bottom). */
  const spinTo = (next: Picks, extra: Partial<BuildState> = {}) => {
    const spins: [string, number][] = [];
    for (const r of rows) {
      if (!(r.category in next)) continue;
      const i = indexIn(r.category, next, r.layer);
      if (i !== indexOf(r)) spins.push([r.key, i]);
    }
    setBuild(person, (s) => ({ ...extra, selected: { ...s.selected, ...next } }));
    spins.forEach(([key, i], n) => rowRefs.current[key]?.spinTo(i, n * 70));
  };

  /** `filter`: only this style where a row has it (the Shuffle filter), instead of following the top. */
  const shuffle = (filter = state.styleFilter) => {
    const temp = weather?.temperature;
    const next: Picks = {};
    const lockedPieces = rows.filter((r) => state.locked.includes(r.key)).map(itemAt).flatMap((i) => (i ? [i] : []));
    // Locked rows keep their piece; nothing else may reuse it.
    const used = new Set(lockedPieces.map((i) => i.id));
    // One style for the whole outfit: a locked piece's if there is one, else the top it lands on.
    const styleOf = (i: Item | null | undefined) => (i?.styles.length ? i.styles[Math.floor(Math.random() * i.styles.length)] : null);
    let style = filter ?? styleOf(lockedPieces.find((i) => i.styles.length));
    // Tops first, so the other rows can follow the top's style.
    const order = [...rows].sort((a, b) => Number(b.category === 'top') - Number(a.category === 'top'));
    for (const r of order) {
      const list = (next[r.category] ??= [...(state.selected[r.category] ?? [])]);
      if (state.locked.includes(r.key)) continue;
      const all = cards[r.category]
        .map((card, i) => ({ card, i }))
        .filter(({ card }) => !card.item || !used.has(card.item.id))
        // No bottoms is a deliberate choice (a dress), never a random one; lock the row to keep it.
        .filter(({ card }) => card.item || r.category !== 'bottom');
      const suits = all.filter(({ card }) => !card.item || suitsTemperature(card.item, temp));
      // Pieces in the outfit's style (plus None, where the row has it), if the row has any.
      const styled = (t: typeof all) => {
        const match = style ? t.filter(({ card }) => card.item?.styles.includes(style!)) : [];
        return match.length ? [...match, ...t.filter(({ card }) => !card.item)] : [];
      };
      // Best tier first: style and weather, then weather, then style, then anything. A chosen
      // filter outranks the weather.
      const tiers = filter ? [styled(suits), styled(all), suits, all] : [styled(suits), suits, styled(all), all];
      const tier = tiers.find((t) => t.length) ?? [];
      const fresh = tier.filter(({ i }) => i !== indexOf(r));
      const pool = fresh.length ? fresh : tier;
      const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
      const id = pick ? (pick.card.item?.id ?? null) : (itemAt(r)?.id ?? null);
      list[r.layer] = id;
      if (id !== null) used.add(id);
      if (r.category === 'top' && !style) style = styleOf(pick?.card.item);
    }
    // Landed on a dress: it goes on its own.
    spinTo((next.top ?? []).some(isDress) ? { ...next, ...dressOff() } : next, { beforeDress: null });
  };

  const backToPick = () =>
    suggestion &&
    spinTo(suggestion.selected, { locked: [], outerwear: suggestion.showOuterwear ? true : null });

  /** Add another top / outerwear row, starting on a piece not already in the outfit. */
  const addLayer = (c: Category) => {
    const current = rows.filter((r) => r.category === c).map((r) => itemAt(r)?.id ?? null);
    const free = cards[c].find((k) => k.item && !combo.includes(k.item.id))?.item?.id ?? null;
    setBuild(person, (s) => ({ selected: { ...s.selected, [c]: [...current, free] } }));
  };

  const removeLayer = (r: Row) =>
    setBuild(person, (s) => ({
      selected: { ...s.selected, [r.category]: (s.selected[r.category] ?? []).filter((_, i) => i !== r.layer) },
      // Locks are by row position, so drop this row's and shift the ones below it up.
      locked: s.locked.flatMap((k) => {
        const [c, l] = k.split(':');
        if (c !== r.category) return [k];
        const n = Number(l);
        return n === r.layer ? [] : [n > r.layer ? `${c}:${n - 1}` : k];
      }),
    }));

  const save = async () => {
    setBusy('save');
    try {
      const outfit = await api.post<Outfit>('/outfits', { person, pieces });
      invalidate(outfitsKey(person));
      setBuild(person, () => ({ editing: null }));
      if (outfit.existing) setToast({ id: Date.now(), text: 'Already saved' });
      else setPhotoFor(outfit);
    } catch (e) {
      setToast({ id: Date.now(), text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  /** Editing: put the rows' pieces into the outfit being edited. */
  const saveChanges = async () => {
    if (!state.editing) return;
    setBusy('save');
    try {
      await api.put<Outfit>(`/outfits/${state.editing.id}`, { pieces });
      invalidate(outfitsKey(person));
      invalidate('/items/');
      setBuild(person, () => ({ editing: null }));
      setToast({ id: Date.now(), text: 'Outfit updated' });
    } catch (e) {
      setToast({ id: Date.now(), text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const wear = async () => {
    setBusy('wear');
    try {
      const undo = await wearToday(person, combo);
      setToast({ id: Date.now(), text: 'Logged for today', action: { label: 'Undo', run: undo } });
    } catch (e) {
      setToast({ id: Date.now(), text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;
  if (!(items ?? []).some((i) => i.categories.length)) {
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader title="Build" />
        <Empty
          title="Add your first piece"
          body="Once a few things are in your closet, you can put outfits together here."
          action={<PrimaryButton onClick={() => navigate(`/${person}/add`)}>Add clothes</PrimaryButton>}
        />
      </div>
    );
  }

  const shownIds = (c: Category) => rows.filter((r) => r.category === c).flatMap((r) => (itemAt(r) ? [itemAt(r)!.id] : []));
  const isPick =
    !!suggestion &&
    suggestion.source !== 'empty' &&
    showOuterwear === suggestion.showOuterwear &&
    ROW_TYPES.every(
      (t) => (t.id === 'outerwear' && !showOuterwear) || shownIds(t.id).join() === suggestion.selected[t.id].join(),
    );
  const weatherText =
    weather &&
    `${weather.current ?? weather.high}°, ${weather.summary.toLowerCase()}${
      weather.precipChance >= 30 ? `, ${weather.precipChance}% rain` : ''
    }${weather.conditions.includes('windy') ? ', windy' : ''}`;
  const subtitle =
    suggestion && suggestion.source !== 'empty' ? (
      <>
        {isPick ? (
          <span className="text-accent">{suggestion.planned ? 'Planned for today' : "Today's pick"}</span>
        ) : (
          <button onClick={backToPick} className="-my-2 py-2 text-accent underline-offset-2 active:underline">
            Back to today's pick
          </button>
        )}
        {weatherText && <> · {weatherText}</>}
      </>
    ) : (
      weatherText
    );

  const outerwearToggle = (
    <button
      // Showing it with nothing chosen yet starts on the first jacket, not on None.
      onClick={() =>
        setBuild(person, (s) => ({
          outerwear: !showOuterwear,
          selected:
            !showOuterwear && !s.selected.outerwear?.some((id) => id !== null)
              ? { ...s.selected, outerwear: [cards.outerwear.find((k) => k.item)?.item?.id ?? null] }
              : s.selected,
        }))
      }
      aria-pressed={showOuterwear}
      className="min-h-tap shrink-0 whitespace-nowrap rounded-full px-3 text-label text-muted active:bg-stage"
    >
      {showOuterwear ? 'Hide outerwear' : 'Add outerwear'}
    </button>
  );

  const actions = (
    <div className={`flex gap-2 ${rail ? '' : 'w-full'}`}>
      <ActionButton onClick={() => shuffle()} label="Shuffle" rail={rail} icon={<Shuffle size={20} />} spin />
      <button
        onClick={() => setFilterOpen(true)}
        aria-label={state.styleFilter ? `Shuffle style: ${state.styleFilter}` : 'Shuffle style: any'}
        className={`flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-label font-medium transition-colors ${
          state.styleFilter ? 'bg-accent text-paper' : 'bg-stage text-ink'
        }`}
      >
        <ListFilter size={18} />
        {/* Phones have no room for the name; the colour says a filter is on. */}
        {state.styleFilter && rail && <span className="max-w-24 truncate">{state.styleFilter}</span>}
      </button>
      {state.editing ? (
        <ActionButton
          onClick={saveChanges}
          disabled={!combo.length || busy !== null || unchanged}
          label={unchanged ? 'No changes' : 'Save changes'}
          rail={rail}
          icon={<Pencil size={20} />}
          done={unchanged}
        />
      ) : saved && !rail ? (
        // Phones: the rows are a saved outfit, so this opens it (the tablet shows it in a corner).
        <ActionButton
          onClick={() => openOverlay('outfit', saved.id)}
          label="View"
          rail={rail}
          keepIcon
          icon={
            saved.photo ? (
              <img src={img(saved.photo)} alt="" className="size-7 max-w-none shrink-0 rounded-full object-cover" />
            ) : (
              <BookmarkCheck size={20} />
            )
          }
          done
        />
      ) : (
        <ActionButton
          onClick={save}
          disabled={!combo.length || busy !== null}
          label={saved ? 'Saved' : 'Save outfit'}
          rail={rail}
          icon={saved ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
          done={!!saved}
        />
      )}
      <ActionButton
        onClick={wear}
        disabled={!combo.length || busy !== null || wornToday}
        label={wornToday ? 'Worn today' : 'Wear today'}
        rail={rail}
        primary
        icon={<Check size={20} strokeWidth={2.2} />}
        done={wornToday}
      />
    </div>
  );

  // Each piece's shared-element transition belongs to the first row showing it centred.
  const heroRows = new Map<number, string>();
  for (const r of rows) {
    const item = itemAt(r);
    if (item && !heroRows.has(item.id)) heroRows.set(item.id, r.key);
  }

  const layerButton = (r: Row) => {
    if (!LAYERED.includes(r.category)) return null;
    const count = rows.filter((x) => x.category === r.category).length;
    if (r.layer > 0) {
      return (
        <button
          onClick={() => removeLayer(r)}
          aria-label={`Remove ${r.label.toLowerCase()}`}
          className="grid size-11 place-items-center rounded-full text-muted active:bg-stage"
        >
          <X size={16} />
        </button>
      );
    }
    // "+ Layer" sits on the category's first row; new layers appear below the last one.
    if (count >= MAX_LAYERS || cards[r.category].filter((k) => k.item).length < 2) return null;
    return (
      <button
        onClick={() => addLayer(r.category)}
        aria-label={`Add a layer to ${r.label.toLowerCase()}`}
        className="flex min-h-11 items-center gap-1 rounded-full px-2 text-caption text-muted active:bg-stage"
      >
        <Plus size={14} /> Layer
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Build" subtitle={subtitle}>
        {outerwearToggle}
        {rail && actions}
      </ScreenHeader>

      {state.editing && (
        <div className="mx-4 mb-1 flex min-h-12 shrink-0 items-center gap-2 rounded-md bg-stage pl-4 pr-1 rail:mx-8">
          <Pencil size={16} className="shrink-0 text-muted" />
          <p className="min-w-0 flex-1 truncate text-label">
            Editing <span className="font-medium">{state.editing.name ?? 'outfit'}</span>
          </p>
          <button onClick={save} disabled={busy !== null || !combo.length} className="min-h-11 shrink-0 rounded-full px-3 text-label text-accent">
            Save as new
          </button>
          <button
            onClick={() => setBuild(person, () => ({ editing: null }))}
            className="min-h-11 shrink-0 rounded-full px-3 text-label text-muted"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col pb-2">
        <AnimatePresence>
          {saved && !state.editing && rail && (
            <SavedPeek key={saved.id} outfit={saved} onOpen={() => openOverlay('outfit', saved.id)} />
          )}
        </AnimatePresence>
        {rows.map((r) =>
          !cards[r.category].some((k) => k.item) ? (
            <EmptyRow key={r.key} label={r.label} action={r.empty} onAdd={() => navigate(`/${person}/add`)} />
          ) : (
          <SwipeRow
            key={r.key}
            ref={(h) => {
              rowRefs.current[r.key] = h;
            }}
            label={r.label}
            labelExtra={layerButton(r)}
            cards={cards[r.category]}
            index={indexOf(r)}
            onSettle={(i) => onSettle(r, i)}
            locked={state.locked.includes(r.key)}
            onToggleLock={() =>
              setBuild(person, (s) => ({
                locked: s.locked.includes(r.key) ? s.locked.filter((k) => k !== r.key) : [...s.locked, r.key],
              }))
            }
            onOpen={(item) => openOverlay('item', item.id)}
            emptyLabel={r.empty}
            onEmpty={() => navigate(`/${person}/add`)}
            heroIndex={itemAt(r) && heroRows.get(itemAt(r)!.id) === r.key ? indexOf(r) : null}
            grow={r.grow}
            fit={r.category === 'bottom' ? fitBottom : undefined}
          />
          ),
        )}
      </div>

      <div className="relative shrink-0">
        <Toast message={toast} onDone={() => setToast(null)} />
        <MusicStrip person={person} className={rail ? 'mx-8 mb-4 ml-auto w-[26rem]' : 'mx-4 mb-2'} />
        {!rail && <div className="px-4 pb-3">{actions}</div>}
      </div>

      <OutfitPhotoSheet outfit={photoFor} onClose={() => setPhotoFor(null)} />
      <StyleFilterSheet
        open={filterOpen}
        styles={(styleList ?? []).filter((s) => (items ?? []).some((i) => i.categories.length && i.styles.includes(s)))}
        value={state.styleFilter}
        onClose={() => setFilterOpen(false)}
        onPick={(s) => {
          setFilterOpen(false);
          setBuild(person, () => ({ styleFilter: s }));
          // Picking a style shuffles into it straight away.
          if (s) shuffle(s);
        }}
      />
    </div>
  );
}

/** What Shuffle draws from: any style, or just one. */
function StyleFilterSheet({ open, styles, value, onClose, onPick }: {
  open: boolean;
  styles: string[];
  value: string | null;
  onClose: () => void;
  onPick: (style: string | null) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-3 pb-4">
        <p className="font-serif text-title">Shuffle by style</p>
        <p className="mt-1 text-label text-muted">Shuffle picks only pieces tagged with this style.</p>
      </div>
      <div className="flex flex-wrap gap-2 px-2 pb-2">
        {[null, ...styles].map((s) => (
          <motion.button
            key={s ?? 'any'}
            whileTap={{ scale: 0.96 }}
            transition={spring.snappy}
            onClick={() => onPick(s)}
            aria-pressed={value === s}
            className={`min-h-12 rounded-md px-4 text-label font-medium transition-colors ${
              value === s ? 'bg-ink text-on-ink' : 'bg-stage text-ink'
            }`}
          >
            {s ?? 'Any style'}
          </motion.button>
        ))}
      </div>
    </Sheet>
  );
}

/** The rows add up to a saved outfit: it pops up in the corner, with its photo if it has one. */
function SavedPeek({ outfit, onOpen }: { outfit: Outfit; onOpen: () => void }) {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.85, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: 12 }}
      transition={spring.snappy}
      whileTap={{ scale: 0.96 }}
      onClick={onOpen}
      className="absolute right-3 bottom-3 z-20 flex items-center gap-3 rounded-lg bg-paper p-1.5 pr-3 shadow-[0_8px_28px_var(--shadow-cutout)] ring-1 ring-line rail:right-8"
    >
      {outfit.photo ? (
        <img src={img(outfit.photo)} alt="" className="h-28 w-21 rounded-md object-cover rail:h-36 rail:w-27" />
      ) : (
        <span className="grid size-11 place-items-center rounded-md bg-stage text-accent">
          <BookmarkCheck size={20} />
        </span>
      )}
      <span className="text-left">
        <span className="block text-caption text-muted">Saved outfit</span>
        <span className="flex items-center gap-0.5 text-label font-medium">
          {outfit.name ?? 'View outfit'} <ChevronRight size={16} className="text-muted" />
        </span>
      </span>
    </motion.button>
  );
}

/** A category with nothing in it yet: a slim line, so the real rows get the room. */
function EmptyRow({ label, action, onAdd }: { label: string; action: string; onAdd: () => void }) {
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-1 px-2 rail:px-5">
      <span className="px-3 text-caption text-muted">{label}</span>
      <button onClick={onAdd} className="flex min-h-11 items-center gap-1 rounded-full px-2 text-caption text-muted active:bg-stage">
        <Plus size={14} /> {action}
      </button>
    </div>
  );
}

function ActionButton({ onClick, label, icon, rail, primary, disabled, done, spin, keepIcon }: {
  onClick: () => void;
  label: string;
  icon: ReactNode;
  rail: boolean;
  primary?: boolean;
  disabled?: boolean;
  /** Already saved / worn: shown calm, not as a call to action. */
  done?: boolean;
  /** Turn the icon half a revolution per press (shuffle), so the tap is answered at once. */
  spin?: boolean;
  /** Show the icon even on narrow phones (where icons are otherwise dropped). */
  keepIcon?: boolean;
}) {
  const [turns, setTurns] = useState(0);
  return (
    <motion.button
      onClick={() => {
        setTurns((t) => t + 1);
        onClick();
      }}
      disabled={disabled}
      whileTap={{ scale: 0.95 }}
      transition={spring.snappy}
      className={`flex min-h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-label font-medium transition-colors ${
        rail ? 'px-4' : 'flex-auto px-3 max-[430px]:px-2.5'
      } ${primary && !done ? 'bg-ink text-on-ink' : 'bg-stage text-ink'} ${done ? '' : 'disabled:opacity-40'}`}
    >
      <motion.span
        key={done ? 'done' : 'idle'}
        initial={done ? { scale: 0.5 } : false}
        animate={{ scale: 1, rotate: spin ? turns * 180 : 0 }}
        transition={spring.settle}
        // Narrow phones: labels alone, so all three fit on one line.
        className={`grid shrink-0 place-items-center ${keepIcon ? '' : 'max-[430px]:hidden'}`}
      >
        {icon}
      </motion.span>
      {label}
    </motion.button>
  );
}

/** Right after saving: offer to add a photo of the person wearing it. */
function OutfitPhotoSheet({ outfit, onClose }: { outfit: Outfit | null; onClose: () => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file || !outfit) return;
    setProgress(0);
    try {
      await uploadOutfitPhoto(outfit, file, setProgress);
      onClose();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Sheet open={!!outfit} onClose={onClose}>
      <div className="px-3 pb-4">
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.settle}
          className="flex items-center gap-2 font-serif text-title"
        >
          <BookmarkCheck size={24} className="text-accent" /> Outfit saved
        </motion.p>
        <p className="mt-1 text-label text-muted">Add a photo of you wearing it? It'll show first in Outfits.</p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => camera.current?.click()}
          disabled={progress !== null}
          className="flex min-h-14 items-center justify-center gap-3 rounded-lg bg-ink text-body font-medium text-on-ink disabled:opacity-60"
        >
          <Camera size={20} />
          {progress === null ? 'Take a photo' : `Uploading… ${Math.round(progress * 100)}%`}
        </button>
        <button
          onClick={() => library.current?.click()}
          disabled={progress !== null}
          className="flex min-h-14 items-center justify-center gap-3 rounded-lg bg-stage text-body font-medium"
        >
          <Images size={20} /> Choose a photo
        </button>
        <button onClick={onClose} className="min-h-tap text-label text-muted">
          Not now
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={library} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </Sheet>
  );
}
