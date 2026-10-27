/** A person's URL id (a slug of their name, made by the server). */
export type PersonId = string;
export type Category = 'headwear' | 'outerwear' | 'top' | 'bottom' | 'shoes';
export type WeatherTag = 'hot' | 'warm' | 'cool' | 'cold' | 'rainy' | 'windy';
export type Temperature = 'hot' | 'warm' | 'cool' | 'cold';

export interface Person {
  id: PersonId;
  name: string;
  photo: string | null;
}

export interface AppConfig {
  idleTimeoutSeconds: number;
  /** "Make it perfect" (AI product shots) is set up. */
  ai: boolean;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().then((j) => j.error, () => res.statusText);
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T = void>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

/** Image paths are stored relative to the images volume. */
export const img = (p: string | null | undefined) => (p ? `/images/${p}` : undefined);

export interface Item {
  id: number;
  owner: PersonId;
  shared: boolean;
  /** Rows it can go in; empty = still needs tagging. */
  categories: Category[];
  /** Weather it suits; empty = any weather. */
  weather: WeatherTag[];
  styles: string[];
  name: string | null;
  original: string;
  cutout: string | null;
  thumb: string | null;
  status: 'processing' | 'ready' | 'failed';
  /** The AI-recreated version ("Make it perfect"), if one was asked for. */
  ai: { status: 'processing' | 'ready' | 'failed'; error: string | null } | null;
  /** `cutout`/`thumb` are the AI version rather than the real photo. */
  useAi: boolean;
  /** A top that's a dress: worn without bottoms or outerwear. */
  dress: boolean;
  archived: boolean;
  createdAt: string;
  lastWorn: string | null;
}

export const CATEGORIES: { id: Category; label: string; one: string }[] = [
  { id: 'headwear', label: 'Headwear', one: 'Headwear' },
  { id: 'outerwear', label: 'Outerwear', one: 'Outerwear' },
  { id: 'top', label: 'Tops', one: 'Top' },
  { id: 'bottom', label: 'Bottoms', one: 'Bottom' },
  { id: 'shoes', label: 'Shoes', one: 'Shoes' },
];

export const WEATHER: { id: WeatherTag; label: string }[] = [
  { id: 'hot', label: 'Hot' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'cold', label: 'Cold' },
  { id: 'rainy', label: 'Rainy' },
  { id: 'windy', label: 'Windy' },
];
export const TEMPERATURES: Temperature[] = ['hot', 'warm', 'cool', 'cold'];

/** Whether a piece suits today's temperature (no temperature tags = any). Mirrors server rules.ts. */
export function suitsTemperature(item: Item, today: Temperature | undefined) {
  const temps = item.weather.filter((t): t is Temperature => (TEMPERATURES as string[]).includes(t));
  return !today || temps.length === 0 || temps.includes(today);
}

/** Rows that can hold more than one piece (layers). */
export const LAYERED: Category[] = ['outerwear', 'top'];
export const MAX_LAYERS = 3;

export const stylesKey = '/styles';

export const itemsKey = (person: PersonId) => `/items?person=${person}`;

export interface Outfit {
  id: number;
  person: PersonId;
  name: string | null;
  photo: string | null;
  createdAt: string;
  lastWorn: string | null;
  /** Pieces head to toe, layers in order; `slot` is the Build row each was saved in. */
  items: (Item & { slot: Category | null })[];
  existing?: boolean;
}

export const outfitsKey = (person: PersonId) => `/outfits?person=${person}`;
export const wornKey = (person: PersonId) => `/wear?person=${person}`;

/** Item ids per row, in layer order. An empty list = nothing (headwear: None). */
export type Selection = Record<Category, number[]>;

export interface Suggestion {
  date: string;
  source: 'outfit' | 'pieces' | 'empty';
  outfitId: number | null;
  /** The outfit was planned for today on the calendar. */
  planned?: boolean;
  selected: Selection;
  showOuterwear: boolean;
}

export const suggestionKey = (person: PersonId) => `/suggestion?person=${person}`;

export interface CalendarData {
  today: string;
  /** Days something was logged: the saved outfit when the pieces make one, and the pieces. */
  worn: { date: string; outfitId: number | null; items: (Item & { slot: Category | null })[] }[];
  plans: { date: string; outfitId: number }[];
}

export const calendarKey = (person: PersonId, from: string, to: string) =>
  `/calendar?person=${person}&from=${from}&to=${to}`;

export interface SpotifyStatus {
  /** The server has Spotify credentials (see README). */
  enabled: boolean;
  connected: boolean;
  name: string | null;
  morning: { uri: string; name: string | null } | null;
  device: { id: string; name: string | null } | null;
}

export interface SpotifyPlayer {
  isPlaying: boolean;
  device: { id: string; name: string; type: string } | null;
  context: string | null;
  track: { name: string; uri: string; by: string; image: string | null } | null;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

export interface SpotifyPlaylist {
  uri: string;
  name: string;
  image: string | null;
  tracks: number;
}

export const spotifyKey = (person: PersonId, what: 'status' | 'player' | 'devices' | 'playlists') =>
  `/spotify/${what}?person=${person}`;
