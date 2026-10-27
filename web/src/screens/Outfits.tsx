import { CalendarDays } from 'lucide-react';
import { outfitsKey, type Outfit, type PersonId } from '../api';
import { Empty, PrimaryButton } from '../components/Empty';
import { OutfitTile } from '../components/OutfitTile';
import { ScreenHeader } from '../components/ScreenHeader';
import { useQuery } from '../lib/query';
import { navigate, openOverlay } from '../router';

/** What was worn each day, and outfits planned ahead. */
function CalendarButton() {
  return (
    <button
      onClick={() => openOverlay('calendar', new Date().toLocaleDateString('en-CA').slice(0, 7))}
      className="flex min-h-tap items-center gap-1.5 rounded-full bg-stage px-4 text-label font-medium active:opacity-80"
    >
      <CalendarDays size={18} /> Calendar
    </button>
  );
}

/** Saved outfits, photo-first. */
export function Outfits({ person }: { person: PersonId }) {
  const { data: outfits, loading } = useQuery<Outfit[]>(outfitsKey(person));
  if (loading) return null;

  if (!outfits?.length) {
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader title="Outfits">
          <CalendarButton />
        </ScreenHeader>
        <Empty
          title="Save your first outfit"
          body="Put one together in Build, then tap Save outfit. Add a photo of you wearing it if you like."
          action={<PrimaryButton onClick={() => navigate(`/${person}/build`)}>Go to Build</PrimaryButton>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Outfits">
        <span className="text-label text-muted tabular-nums">{outfits.length}</span>
        <CalendarButton />
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-8 rail:px-7">
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-x-4">
          {outfits.map((o) => (
            <OutfitTile key={o.id} outfit={o} onOpen={() => openOverlay('outfit', o.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
