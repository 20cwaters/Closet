import { config } from './config.js';
import { db } from './db.js';

/** A town, as chosen in the app. */
export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export interface Location {
  /** Null when the coordinates came from LAT/LON. */
  name: string | null;
  lat: number;
  lon: number;
  /** False while it's still the built-in default: the app then asks where home is. */
  chosen: boolean;
}

/** Where the weather is for: the town picked in the app, else LAT/LON. */
export function currentLocation(): Location {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'place'").get() as { value: string } | undefined;
  if (row) return { ...(JSON.parse(row.value) as Place), chosen: true };
  return { name: null, lat: config.lat, lon: config.lon, chosen: config.locationConfigured };
}

export function savePlace(place: Place) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('place', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(place));
}

const MAX_NAME = 120;

/** A Place from a request body, or null if it isn't one. */
export function parsePlace(raw: unknown): Place | null {
  const { name, lat, lon } = (raw ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (typeof lon !== 'number' || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  return { name: name.trim(), lat, lon };
}

interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
}

/** "Dublin, Leinster, Ireland", leaving out a region that just repeats the town. */
export const placeName = ({ name, admin1, country }: GeocodeResult) =>
  [name, admin1 !== name ? admin1 : undefined, country].filter(Boolean).join(', ');

/** Towns matching `query`, from Open-Meteo's geocoder (the weather's source; no key needed). */
export async function searchPlaces(query: string): Promise<Place[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
  const { results = [] } = (await res.json()) as { results?: GeocodeResult[] };
  return results.map((r) => ({ name: placeName(r), lat: r.latitude, lon: r.longitude }));
}
