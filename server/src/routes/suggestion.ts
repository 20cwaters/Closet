import { Router } from 'express';
import { today } from '../config.js';
import { db, isPerson } from '../db.js';
import { rules, type Category } from '../rules.js';
import { plannedOutfit } from './calendar.js';
import { withTags } from './items.js';
import { suggest } from '../suggest.js';
import { getWeather, type Weather } from '../weather.js';

export const suggestion = Router();

suggestion.get('/', async (req, res) => {
  const person = String(req.query.person ?? '');
  if (!isPerson(person)) return void res.status(400).json({ error: 'person is required' });
  const date = today();

  // Without weather, fall back to "cool, dry".
  const weather: Weather | null = await getWeather().catch(() => null);

  const items = withTags(
    db
      .prepare(
        `SELECT i.*, (SELECT MAX(worn_on) FROM wear_log w
                      WHERE w.item_id = i.id AND w.person = @person AND w.worn_on < @date) AS last_worn
         FROM items i WHERE (i.owner = @person OR i.shared = 1) AND i.archived = 0`,
      )
      .all({ person, date }) as Parameters<typeof withTags>[0],
  )
    .filter((i) => i.categories.length)
    .map((i) => ({ id: i.id, categories: i.categories, weather: i.weather, lastWorn: i.lastWorn, dress: i.dress, styles: i.styles }));

  const outfits = new Map<number, { id: number; slot: Category }[]>();
  for (const r of db
    .prepare(
      `SELECT oi.outfit_id, oi.item_id, oi.slot FROM outfit_items oi JOIN outfits o ON o.id = oi.outfit_id
       WHERE o.person = ? AND oi.slot IS NOT NULL ORDER BY oi.outfit_id, oi.position`,
    )
    .all(person) as { outfit_id: number; item_id: number; slot: Category }[]) {
    if (!outfits.has(r.outfit_id)) outfits.set(r.outfit_id, []);
    outfits.get(r.outfit_id)!.push({ id: r.item_id, slot: r.slot });
  }

  // An outfit planned on the calendar for today beats the rules.
  const planned = plannedOutfit(person, date);
  const plan = planned !== undefined ? outfits.get(planned) : undefined;
  if (plan) {
    const selected = { headwear: [], outerwear: [], top: [], bottom: [], shoes: [] } as Record<Category, number[]>;
    for (const p of plan) selected[p.slot].push(p.id);
    return void res.json({
      date,
      source: 'outfit',
      outfitId: planned,
      planned: true,
      selected,
      showOuterwear: selected.outerwear.length > 0,
      weather,
    });
  }

  res.json({
    ...suggest({
      person,
      date,
      conditions: weather?.conditions ?? ['cool'],
      needsOuterwear: weather?.needsOuterwear ?? false,
      items,
      outfits: [...outfits].map(([id, pieces]) => ({ id, pieces })),
      useWeather: rules.useWeather,
    }),
    weather,
  });
});
