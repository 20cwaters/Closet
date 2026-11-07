import { MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { saveLocation, searchPlaces, type Place } from '../lib/location';
import { Sheet, SheetButton } from './Sheet';

/** Pick the town the weather (and so the daily pick) comes from. */
export function LocationSheet({ open, firstTime = false, onClose }: {
  open: boolean;
  /** Asked unprompted: explain why, and offer a way out. */
  firstTime?: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  // Search as they type, once they pause. Answers to older keystrokes are ignored.
  useEffect(() => {
    const text = query.trim();
    setPlaces(null);
    setError(null);
    if (text.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      searchPlaces(text).then(
        (found) => current && setPlaces(found),
        (e: Error) => current && setError(e.message),
      );
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  const pick = async (place: Place) => {
    try {
      await saveLocation(place);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-3 px-3 pb-2">
        <h2 className="font-serif text-title">Where's home?</h2>
        {firstTime && (
          <p className="text-label text-muted">
            Closet checks the weather there each morning to pick what you'll wear.
          </p>
        )}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Your town or city"
          aria-label="Your town or city"
          autoComplete="off"
          className="min-h-tap rounded-md bg-stage px-4 text-body outline-none placeholder:text-muted"
        />
        {error && <p className="text-label text-danger">{error}</p>}
        {places?.length === 0 && <p className="text-label text-muted">Nothing found. Check the spelling?</p>}
      </div>
      {places?.map((place) => (
        <SheetButton key={`${place.lat},${place.lon}`} icon={<MapPin size={20} />} onClick={() => pick(place)}>
          {place.name}
        </SheetButton>
      ))}
      {firstTime && (
        <button onClick={onClose} className="mt-1 min-h-tap w-full rounded-full text-label text-muted active:bg-stage">
          Not now
        </button>
      )}
    </Sheet>
  );
}
