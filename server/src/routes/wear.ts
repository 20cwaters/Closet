import { Router } from 'express';
import { today } from '../config.js';
import { db, isPerson } from '../db.js';
import { findOutfitWithItems } from './outfits.js';

export const wear = Router();

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function parse(body: Record<string, unknown> | undefined) {
  const { person, itemIds, date } = body ?? {};
  if (!isPerson(person)) return { error: 'person is required' };
  if (!Array.isArray(itemIds) || !itemIds.length || !itemIds.every(Number.isInteger))
    return { error: 'itemIds must be a non-empty list' };
  return { person, itemIds: itemIds as number[], date: isDate(date) ? date : today() };
}

/** Log a combination as worn (today by default). Re-logging the same item on the same day is a no-op. */
wear.post('/', (req, res) => {
  const p = parse(req.body);
  if ('error' in p) return void res.status(400).json({ error: p.error });
  const outfitId = findOutfitWithItems(p.person, p.itemIds) ?? null;
  const insert = db.prepare(
    `INSERT INTO wear_log (person, item_id, outfit_id, worn_on) VALUES (?, ?, ?, ?)
     ON CONFLICT (person, item_id, worn_on) DO UPDATE SET outfit_id = COALESCE(excluded.outfit_id, outfit_id)`,
  );
  db.transaction(() => p.itemIds.forEach((id) => insert.run(p.person, id, outfitId, p.date)))();
  res.json({ date: p.date, outfitId, count: p.itemIds.length });
});

/** Undo a wear log for these items on a day. */
wear.delete('/', (req, res) => {
  const p = parse(req.body);
  if ('error' in p) return void res.status(400).json({ error: p.error });
  const del = db.prepare('DELETE FROM wear_log WHERE person = ? AND item_id = ? AND worn_on = ?');
  let removed = 0;
  db.transaction(() => p.itemIds.forEach((id) => (removed += del.run(p.person, id, p.date).changes)))();
  res.json({ removed });
});

/** Item ids this person has logged for a day (today by default). */
wear.get('/', (req, res) => {
  const person = String(req.query.person ?? '');
  if (!isPerson(person)) return void res.status(400).json({ error: 'person is required' });
  const date = isDate(req.query.date) ? req.query.date : today();
  const ids = db
    .prepare('SELECT item_id FROM wear_log WHERE person = ? AND worn_on = ?')
    .pluck()
    .all(person, date);
  res.json({ date, itemIds: ids });
});
