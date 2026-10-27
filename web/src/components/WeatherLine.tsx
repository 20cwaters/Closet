import type { Temperature, WeatherTag } from '../api';
import { useQuery } from '../lib/query';

export interface Weather {
  date: string;
  current: number | null;
  high: number;
  low: number;
  precipChance: number;
  /** Max wind today, mph. */
  wind: number;
  summary: string;
  temperature: Temperature;
  /** Temperature plus 'rainy' / 'windy' when they apply (server/src/rules.ts). */
  conditions: WeatherTag[];
  needsOuterwear: boolean;
}

/** The server caches for 30 minutes; checking every 15 keeps the tablet within that. */
export const WEATHER_MAX_AGE = 15 * 60_000;

/** Today's weather in one quiet line. Renders nothing if weather is unavailable. */
export function WeatherLine({ className = '' }: { className?: string }) {
  const { data } = useQuery<Weather>('/weather', { maxAge: WEATHER_MAX_AGE });
  if (!data) return <p className={`invisible ${className}`}>&nbsp;</p>;
  const day = new Date(`${data.date}T12:00`).toLocaleDateString(undefined, { weekday: 'long' });
  const rain = data.precipChance >= 30 ? ` · ${data.precipChance}% rain` : '';
  const wind = data.conditions.includes('windy') ? ` · windy` : '';
  return (
    <p className={`text-label text-muted ${className}`}>
      {day} · {data.current ?? data.high}°, {data.summary.toLowerCase()} · high {data.high}°, low {data.low}°
      {rain}
      {wind}
    </p>
  );
}
