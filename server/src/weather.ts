import { config, today } from './config.js';
import { conditionsFor, needsOuterwear, temperatureFor, type Temperature, type WeatherTag } from './rules.js';

export interface Weather {
  date: string;
  current: number | null;
  high: number;
  low: number;
  precipChance: number;
  code: number;
  /** Max wind speed today, mph. */
  wind: number;
  summary: string;
  /** Today's temperature (rules.ts). */
  temperature: Temperature;
  /** Temperature plus 'rainy' / 'windy' when they apply. */
  conditions: WeatherTag[];
  needsOuterwear: boolean;
}

const TTL_MS = 30 * 60 * 1000;
/** If Open-Meteo is unreachable, keep showing the last reading for up to this long. */
const STALE_OK_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; data: Weather } | null = null;
let inflight: Promise<Weather> | null = null;

/** WMO weather codes → a few plain words. */
export function describe(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorms';
  return 'Mixed';
}

async function fetchWeather(): Promise<Weather> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(config.lat),
    longitude: String(config.lon),
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,weather_code',
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    timezone: process.env.TZ || 'auto',
    forecast_days: '1',
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
  const j = (await res.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: (number | null)[];
      wind_speed_10m_max: (number | null)[];
      weather_code: number[];
    };
  };
  const high = Math.round(j.daily.temperature_2m_max[0]);
  const precipChance = j.daily.precipitation_probability_max[0] ?? 0;
  const code = j.current?.weather_code ?? j.daily.weather_code[0];
  const wind = Math.round(j.daily.wind_speed_10m_max[0] ?? 0);
  const conditions = conditionsFor(high, precipChance, wind);
  return {
    date: j.daily.time[0],
    current: j.current?.temperature_2m != null ? Math.round(j.current.temperature_2m) : null,
    high,
    low: Math.round(j.daily.temperature_2m_min[0]),
    precipChance,
    code,
    wind,
    summary: describe(code),
    temperature: temperatureFor(high),
    conditions,
    needsOuterwear: needsOuterwear(high, conditions),
  };
}

/** Today's weather, cached for 30 minutes (and refreshed when the date rolls over). */
export async function getWeather(): Promise<Weather> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS && cache.data.date === today()) return cache.data;
  inflight ??= fetchWeather()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .catch((err) => {
      if (cache && now - cache.at < STALE_OK_MS) {
        console.warn(`weather: ${err.message}; serving reading from ${new Date(cache.at).toISOString()}`);
        return cache.data;
      }
      throw err;
    })
    .finally(() => (inflight = null));
  return inflight;
}
