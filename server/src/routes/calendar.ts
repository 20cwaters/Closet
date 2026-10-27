import { Router } from 'express';
import { today } from '../config.js';
import { db, isPerson } from '../db.js';
import { findOutfitWithItems } from './outfits.js';
import { withTags } from './items.js';

export const calendar = Router();

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The outfit planned for a person on a day, if any. */
export const plannedOutfit = (person: string, date: string) =>
  db.prepare('SELECT outfit_id FROM outfit_plans WHERE person = ? AND date = ?').pluck().get(person, date) as
    | number
    | undefined;

/**
 * Days from `from` to `to`: what was worn (the saved outfit, when the pieces make one, and
 * the pieces themselves) and what's planned.
 */
calendar.get('/', (req, res) => {
  const { person, from, to } = req.query;
  if (!isPerson(person)) return void res.status(400).json({ error: 'person is required' });
  if (!isDate(from) || !isDate(to)) return void res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });

  const rows = db
    .prepare(
      `SELECT i.*, w.worn_on, w.outfit_id AS worn_outfit FROM wear_log w JOIN items i ON i.id = w.item_id
       WHERE w.person = ? AND w.worn_on BETWEEN ? AND ? ORDER BY w.worn_on, w.id`,
    )
    .all(person, from, to) as (Parameters<typeof withTags>[0][number] & { worn_on: string; worn_outfit: number | null })[];
  const items = withTags(rows);
  const byDay = new Map<string, { outfitIds: (number | null)[]; items: typeof items }>();
  rows.forEach((r, i) => {
    const day = byDay.get(r.worn_on) ?? { outfitIds: [], items: [] };
    day.outfitIds.push(r.worn_outfit);
    day.items.push(items[i]);
    byDay.set(r.worn_on, day);
  });
  const worn = [...byDay].map(([date, d]) => {
    const logged = d.outfitIds.every((id) => id !== null && id === d.outfitIds[0]) ? d.outfitIds[0] : null;
    return {
      date,
      outfitId: logged ?? findOutfitWithItems(person, d.items.map((i) => i.id)) ?? null,
      items: d.items.map((i) => ({ ...i, slot: i.categories[0] ?? null })),
    };
  });

  const plans = db
    .prepare('SELECT date, outfit_id AS outfitId FROM outfit_plans WHERE person = ? AND date BETWEEN ? AND ? ORDER BY date')
    .all(person, from, to);
  res.json({ today: today(), worn, plans });
});

/** Plan an outfit for a day (replacing any plan already there). */
calendar.put('/plan', (req, res) => {
  const { person, date, outfitId } = req.body ?? {};
  if (!isPerson(person)) return void res.status(400).json({ error: 'person is required' });
  if (!isDate(date)) return void res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const owner = db.prepare('SELECT person FROM outfits WHERE id = ?').pluck().get(outfitId);
  if (owner !== person) return void res.status(400).json({ error: `That isn't one of ${person}'s outfits` });
  db.prepare(
    `INSERT INTO outfit_plans (person, date, outfit_id) VALUES (?, ?, ?)
     ON CONFLICT (person, date) DO UPDATE SET outfit_id = excluded.outfit_id`,
  ).run(person, date, outfitId);
  res.json({ date, outfitId });
});

calendar.delete('/plan', (req, res) => {
  const { person, date } = req.body ?? {};
  if (!isPerson(person) || !isDate(date)) return void res.status(400).json({ error: 'person and date are required' });
  const { changes } = db.prepare('DELETE FROM outfit_plans WHERE person = ? AND date = ?').run(person, date);
  res.json({ removed: changes });
});
