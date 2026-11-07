import { api } from '../api';
import { invalidate } from './query';

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export interface Location {
  name: string | null;
  lat: number;
  lon: number;
  /** False while it's still the built-in default. */
  chosen: boolean;
}

export const locationKey = '/location';

export const searchPlaces = (query: string) =>
  api.get<Place[]>(`${locationKey}/search?q=${encodeURIComponent(query)}`);

export async function saveLocation(place: Place) {
  await api.put(locationKey, place);
  [locationKey, '/weather', '/suggestion'].forEach(invalidate);
}

/** Whether this device has already been asked where home is. */
const KEY = 'closet.locationAsked';

export function locationAsked() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // private mode: don't ask on every visit
  }
}

export function markLocationAsked() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode */
  }
}
