/**
 * Every rule behind the daily suggestion and the outerwear row, in one place.
 * Edit, then rebuild: `docker compose up -d --build app`.
 */

export type Category = 'headwear' | 'outerwear' | 'top' | 'bottom' | 'shoes';
export const CATEGORIES: Category[] = ['headwear', 'outerwear', 'top', 'bottom', 'shoes'];

/** Weather tags a piece can carry (any number; none = fine in any weather). */
export type WeatherTag = 'hot' | 'warm' | 'cool' | 'cold' | 'rainy' | 'windy';
export const WEATHER_TAGS: WeatherTag[] = ['hot', 'warm', 'cool', 'cold', 'rainy', 'windy'];
export type Temperature = 'hot' | 'warm' | 'cool' | 'cold';
export const TEMPERATURES: Temperature[] = ['hot', 'warm', 'cool', 'cold'];

export const rules = {
  /**
   * Whether the daily pick looks at the weather at all: temperature tags, rain and wind,
   * showing the outerwear row, a hat when cold. Off = the weather is only shown, not used.
   */
  useWeather: false,

  /**
   * Skip a piece if this person wore it within this many days (not counting today).
   * 5 = anything worn in the last five days is skipped; 0 = fine to repeat.
   */
  recencyDays: {
    top: 5,
    bottom: 3,
    outerwear: 0,
    headwear: 0,
    shoes: 0,
  } satisfies Record<Category, number>,

  /**
   * Today's temperature, from the day's high in °F: cold below `coldBelow`, cool below
   * `coolBelow`, warm below `warmBelow`, otherwise hot. A piece tagged with temperatures
   * is only suggested on those days; a piece with no temperature tags suits any.
   */
  temperature: { coldBelow: 45, coolBelow: 65, warmBelow: 80 },

  /** Today is "rainy" above this chance of rain (%), "windy" above this wind speed (mph). */
  rainyAboveChance: 50,
  windyAboveMph: 20,
  // On rainy or windy days, pieces tagged for it are picked first (not required).

  /** Show the outerwear row when the high is below this (°F), or it's rainy or windy. */
  outerwearBelowHigh: 60,
  outerwearWhenRainy: true,
  outerwearWhenWindy: true,

  /** On cold days, suggest a hat tagged Cold if there is one (otherwise headwear is None). */
  hatWhenCold: true,

  /** How many of the best-ranked saved outfits the day's pick is drawn from. */
  outfitShortlist: 3,
} as const;

export function temperatureFor(high: number): Temperature {
  const t = rules.temperature;
  if (high < t.coldBelow) return 'cold';
  if (high < t.coolBelow) return 'cool';
  if (high < t.warmBelow) return 'warm';
  return 'hot';
}

/** Today's conditions: its temperature, plus rainy/windy when they apply. */
export function conditionsFor(high: number, rainChance: number, windMph: number): WeatherTag[] {
  const c: WeatherTag[] = [temperatureFor(high)];
  if (rainChance > rules.rainyAboveChance) c.push('rainy');
  if (windMph > rules.windyAboveMph) c.push('windy');
  return c;
}

export function needsOuterwear(high: number, conditions: WeatherTag[]) {
  return (
    high < rules.outerwearBelowHigh ||
    (rules.outerwearWhenRainy && conditions.includes('rainy')) ||
    (rules.outerwearWhenWindy && conditions.includes('windy'))
  );
}

/** Whether a piece's weather tags allow today's temperature (no temperature tags = any). */
export function suitsTemperature(tags: readonly WeatherTag[], today: Temperature) {
  const temps = tags.filter((t): t is Temperature => (TEMPERATURES as string[]).includes(t));
  return temps.length === 0 || temps.includes(today);
}
