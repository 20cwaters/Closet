import { motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  api,
  calendarKey,
  outfitsKey,
  suggestionKey,
  wornKey,
  type CalendarData,
  type Outfit,
  type PersonId,
} from '../api';
import { Empty, PrimaryButton } from '../components/Empty';
import { OutfitStack } from '../components/OutfitStack';
import { OutfitMedia } from '../components/OutfitTile';
import { Sheet } from '../components/Sheet';
import { Toast, type ToastMessage } from '../components/Toast';
import { setBuild } from '../lib/buildState';
import { localToday } from '../lib/dates';
import { spring } from '../lib/motion';
import { wearToday } from '../lib/outfits';
import { invalidate, useQuery } from '../lib/query';
import { closeOverlay, navigate, openOverlay, setParam } from '../router';
import { Overlay } from './Overlay';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const iso = (d: Date) => d.toLocaleDateString('en-CA');

type Day = {
  date: string;
  worn?: CalendarData['worn'][number];
  /** The planned outfit (still listed for days already past, if nothing was logged). */
  planned?: Outfit;
};

/** What was worn on a day: the saved outfit when there is one, otherwise its pieces laid out. */
function DayMedia({ day, outfits }: { day: Day; outfits: Map<number, Outfit> }) {
  const outfit = day.worn ? (day.worn.outfitId ? outfits.get(day.worn.outfitId) : undefined) : day.planned;
  if (outfit) return <OutfitMedia outfit={outfit} />;
  if (day.worn) return <OutfitStack items={day.worn.items} />;
  return null;
}

/**
 * A month of outfits: what was worn each day (from Wear today), and outfits planned for
 * days ahead. A plan for today becomes the daily pick on Build.
 */
export function Calendar({ month, person }: { month: string; person: PersonId }) {
  const today = localToday();
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
  const [y, m] = valid.split('-').map(Number);
  const length = new Date(y, m, 0).getDate();
  const lead = new Date(y, m - 1, 1).getDay();
  const from = `${valid}-01`;
  const to = `${valid}-${String(length).padStart(2, '0')}`;
  const shift = (n: number) => setParam('calendar', iso(new Date(y, m - 1 + n, 1)).slice(0, 7), { replace: true });

  const { data } = useQuery<CalendarData>(calendarKey(person, from, to));
  const { data: outfitList } = useQuery<Outfit[]>(outfitsKey(person));
  const outfits = new Map((outfitList ?? []).map((o) => [o.id, o]));
  const [selected, setSelected] = useState<string | null>(today);
  const [picking, setPicking] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const days: Day[] = Array.from({ length }, (_, i) => {
    const date = `${valid}-${String(i + 1).padStart(2, '0')}`;
    const plan = data?.plans.find((p) => p.date === date);
    return { date, worn: data?.worn.find((w) => w.date === date), planned: plan && outfits.get(plan.outfitId) };
  });
  const day = days.find((d) => d.date === selected);

  const refresh = (date: string, { wore = false } = {}) => {
    invalidate('/calendar');
    if (wore) {
      invalidate(wornKey(person));
      invalidate(`/items?person=${person}`);
      invalidate(outfitsKey(person));
    }
    // A plan for today replaces the daily pick, so Build reloads it.
    if (date === today && !wore) {
      invalidate(suggestionKey(person));
      setBuild(person, (s) => (s.editing ? {} : { seeded: null }));
    }
  };

  const run = async (date: string, action: () => Promise<unknown>, opts?: { wore?: boolean }) => {
    try {
      await action();
      refresh(date, opts);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const plan = (date: string, outfit: Outfit) =>
    run(date, () => api.put('/calendar/plan', { person, date, outfitId: outfit.id }));
  const unplan = (date: string) => run(date, () => api.del('/calendar/plan', { person, date }));
  const logWorn = (date: string, outfit: Outfit) =>
    run(
      date,
      async () => {
        const itemIds = outfit.items.map((i) => i.id);
        if (date !== today) return api.post('/wear', { person, itemIds, date });
        const undo = await wearToday(person, itemIds);
        setToast({ id: Date.now(), text: 'Logged for today', action: { label: 'Undo', run: async () => { await undo(); refresh(date, { wore: true }); } } });
      },
      { wore: true },
    );
  const unlog = (date: string, itemIds: number[]) =>
    run(date, () => api.del('/wear', { person, itemIds, date }), { wore: true });

  const onPick = (outfit: Outfit) => {
    setPicking(false);
    if (!day) return;
    if (day.date < today) logWorn(day.date, outfit);
    else plan(day.date, outfit);
  };

  return (
    <Overlay onClose={() => closeOverlay('calendar')}>
      <div className="flex flex-col px-4 pb-10 rail:h-full rail:flex-row rail:gap-8 rail:px-8 rail:pb-8">
        <div className="flex min-w-0 flex-col rail:min-h-0 rail:flex-1">
          <div className="flex items-center gap-1 pb-3">
            <h1 className="mr-auto pl-1 font-serif text-title">
              {new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </h1>
            {valid !== today.slice(0, 7) && (
              <button
                onClick={() => {
                  setParam('calendar', today.slice(0, 7), { replace: true });
                  setSelected(today);
                }}
                className="min-h-tap rounded-full px-3 text-label text-muted active:bg-stage"
              >
                Today
              </button>
            )}
            <button onClick={() => shift(-1)} aria-label="Previous month" className="grid size-11 place-items-center rounded-full active:bg-stage">
              <ChevronLeft size={22} />
            </button>
            <button onClick={() => shift(1)} aria-label="Next month" className="grid size-11 place-items-center rounded-full active:bg-stage">
              <ChevronRight size={22} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-caption text-muted">
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div
            className="grid grid-cols-7 gap-1 rail:min-h-0 rail:flex-1"
            style={{ gridTemplateRows: `repeat(${Math.ceil((lead + length) / 7)}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: lead }, (_, i) => (
              <span key={`lead${i}`} />
            ))}
            {days.map((d) => {
              const n = Number(d.date.slice(8));
              const has = d.worn || d.planned;
              return (
                <motion.button
                  key={d.date}
                  whileTap={{ scale: 0.95 }}
                  transition={spring.snappy}
                  onClick={() => setSelected(d.date)}
                  aria-label={new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
                  aria-pressed={selected === d.date}
                  className={`relative aspect-[3/4] min-h-0 overflow-hidden rounded-md rail:aspect-auto ${
                    d.worn ? 'bg-stage' : d.planned ? 'border border-dashed border-muted' : 'bg-stage/40'
                  } ${selected === d.date ? 'ring-2 ring-ink' : ''}`}
                >
                  {has && (
                    <div className={`absolute inset-0 ${d.worn ? '' : 'opacity-70'}`}>
                      <DayMedia day={d} outfits={outfits} />
                    </div>
                  )}
                  <span
                    className={`absolute top-0.5 left-0.5 grid size-5 place-items-center rounded-full text-[0.6875rem] leading-none tabular-nums ${
                      d.date === today ? 'bg-ink font-semibold text-on-ink' : has ? 'bg-paper/80' : d.date < today ? 'text-muted' : ''
                    }`}
                  >
                    {n}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="relative mt-6 rail:mt-14 rail:w-[24rem] rail:shrink-0 rail:overflow-y-auto">
          <Toast message={toast} onDone={() => setToast(null)} />
          {day ? (
            <DayPanel
              day={day}
              today={today}
              outfits={outfits}
              onPick={() => setPicking(true)}
              onWear={(o) => logWorn(day.date, o)}
              onUnplan={() => unplan(day.date)}
              onUnlog={(ids) => unlog(day.date, ids)}
            />
          ) : (
            <p className="px-1 text-label text-muted">Tap a day to see what you wore, or plan an outfit for it.</p>
          )}
        </div>
      </div>

      <Sheet open={picking} onClose={() => setPicking(false)}>
        <h2 className="px-1 pb-3 font-serif text-title">
          {day && day.date < today ? 'What did you wear?' : 'Pick an outfit'}
        </h2>
        {outfitList?.length ? (
          <div className="grid max-h-[60svh] grid-cols-3 gap-x-2 gap-y-3 overflow-y-auto pb-2">
            {outfitList.map((o) => (
              <motion.button
                key={o.id}
                whileTap={{ scale: 0.95 }}
                transition={spring.snappy}
                onClick={() => onPick(o)}
                className="flex flex-col text-left"
              >
                <div className={`aspect-[3/4] w-full overflow-hidden rounded-md ${o.photo ? 'bg-stage' : 'bg-stage/50'}`}>
                  <OutfitMedia outfit={o} />
                </div>
                {o.name && <span className="mt-1 truncate px-0.5 text-caption">{o.name}</span>}
              </motion.button>
            ))}
          </div>
        ) : (
          <div className="h-56">
            <Empty
              title="No outfits yet"
              body="Save one in Build first."
              action={<PrimaryButton onClick={() => navigate(`/${person}/build`)}>Go to Build</PrimaryButton>}
            />
          </div>
        )}
      </Sheet>
    </Overlay>
  );
}

function DayPanel({ day, today, outfits, onPick, onWear, onUnplan, onUnlog }: {
  day: Day;
  today: string;
  outfits: Map<number, Outfit>;
  onPick: () => void;
  onWear: (o: Outfit) => void;
  onUnplan: () => void;
  onUnlog: (itemIds: number[]) => void;
}) {
  const past = day.date < today;
  const label = new Date(`${day.date}T12:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const wornOutfit = day.worn?.outfitId ? outfits.get(day.worn.outfitId) : undefined;
  const shown = day.worn ? wornOutfit : day.planned;
  const status = day.worn
    ? `Worn${wornOutfit?.name ? ` · ${wornOutfit.name}` : ''}`
    : day.planned
      ? `${past ? 'Planned, not logged' : 'Planned'}${day.planned.name ? ` · ${day.planned.name}` : ''}`
      : past
        ? 'Nothing logged'
        : 'Nothing planned yet';

  const pill = 'flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-label font-medium';
  return (
    <div className="flex gap-4 rail:flex-col">
      {(day.worn || day.planned) && (
        <motion.button
          whileTap={shown ? { scale: 0.97 } : undefined}
          transition={spring.snappy}
          onClick={() => shown && openOverlay('outfit', shown.id)}
          disabled={!shown}
          aria-label="Open outfit"
          className="aspect-[3/4] w-32 shrink-0 overflow-hidden rounded-md bg-stage rail:w-48"
        >
          <DayMedia day={day} outfits={outfits} />
        </motion.button>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="font-serif text-title leading-tight">{label}</h2>
        <p className="mt-1 text-label text-muted">{status}</p>
        {day.worn && !wornOutfit && <p className="text-caption text-muted">Pieces worn together, not a saved outfit</p>}

        <div className="mt-4 flex flex-col items-start gap-2">
          {day.worn ? (
            <button onClick={() => onUnlog(day.worn!.items.map((i) => i.id))} className="min-h-tap px-1 text-label text-danger">
              Remove from this day
            </button>
          ) : day.planned ? (
            <>
              {day.date <= today && (
                <button onClick={() => onWear(day.planned!)} className={`${pill} bg-ink text-on-ink`}>
                  <Check size={18} strokeWidth={2.2} /> {past ? 'Log as worn' : 'Wear today'}
                </button>
              )}
              <div className="flex gap-2">
                <button onClick={onPick} className={`${pill} bg-stage`}>Change</button>
                <button onClick={onUnplan} className={`${pill} text-danger`}>Remove</button>
              </div>
            </>
          ) : (
            <button onClick={onPick} className={`${pill} bg-ink text-on-ink`}>
              <Plus size={18} strokeWidth={2.2} /> {past ? 'Log what you wore' : 'Plan an outfit'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
